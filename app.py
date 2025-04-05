from flask import Flask, request, jsonify, send_file, render_template
import os
import subprocess
import whisper
import requests
from gtts import gTTS
import re
import time
from datetime import timedelta
from apscheduler.schedulers.background import BackgroundScheduler

app = Flask(__name__)
app.secret_key = os.urandom(24)
app.permanent_session_lifetime = timedelta(minutes=30)

# Configure folders
UPLOAD_FOLDER = os.path.join(os.getcwd(), "uploads")
STATIC_FOLDER = os.path.join(os.getcwd(), "static")

# Create folders if they don't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(STATIC_FOLDER, exist_ok=True)

# Whisper model (multilingual)
whisper_model = whisper.load_model("base")

# API Config
OPENROUTER_API_KEY = "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"

# Language configuration (English and Hindi only)
LANGUAGE_MAP = {
    'en': {'name': 'English', 'tts_lang': 'en'},
    'hi': {'name': 'Hindi', 'tts_lang': 'hi'}
}

def detect_input_language(audio_path):
    """Use Whisper to detect the language from audio"""
    try:
        # Load audio and pad/trim it to fit 30 seconds
        audio = whisper.load_audio(audio_path)
        audio = whisper.pad_or_trim(audio)
        
        # Make log-Mel spectrogram
        mel = whisper.log_mel_spectrogram(audio).to(whisper_model.device)
        
        # Detect the spoken language
        _, probs = whisper_model.detect_language(mel)
        detected_lang = max(probs, key=probs.get)
        # Only allow English or Hindi, default to English
        return detected_lang if detected_lang in ['en', 'hi'] else 'en'
    except Exception as e:
        print(f"Language detection error: {e}")
        return 'en'  # Default to English

# Cleanup old files function
def cleanup_old_files():
    now = time.time()
    for folder in [UPLOAD_FOLDER, STATIC_FOLDER]:
        for filename in os.listdir(folder):
            path = os.path.join(folder, filename)
            try:
                if os.path.getmtime(path) < now - 3600:  # 1 hour old
                    os.remove(path)
                    print(f"Cleaned up: {path}")
            except Exception as e:
                print(f"Error cleaning {path}: {e}")

# Setup scheduled cleanup
scheduler = BackgroundScheduler()
scheduler.add_job(cleanup_old_files, 'interval', hours=1)
scheduler.start()

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/process_audio", methods=["POST"])
def process_audio():
    # Generate unique filenames for this request
    timestamp = int(time.time())
    webm_path = os.path.join(UPLOAD_FOLDER, f"input_{timestamp}.webm")
    wav_path = os.path.join(UPLOAD_FOLDER, f"input_{timestamp}.wav")
    output_path = os.path.join(STATIC_FOLDER, f"output_{timestamp}.mp3")

    try:
        # Clean any existing files for this request
        for path in [webm_path, wav_path, output_path]:
            if os.path.exists(path):
                os.remove(path)

        if 'audio' not in request.files:
            return jsonify({"error": "No audio file"}), 400

        audio_file = request.files['audio']
        audio_file.save(webm_path)
        os.chmod(webm_path, 0o777)

        # Validate file
        if not os.path.exists(webm_path) or os.path.getsize(webm_path) < 2048:
            raise ValueError("Invalid audio file")

        # Convert to WAV
        subprocess.run([
            "ffmpeg", "-y",
            "-i", webm_path,
            "-ar", "16000",
            "-ac", "1",
            "-acodec", "pcm_s16le",
            wav_path
        ], check=True)

        if not os.path.exists(wav_path):
            raise RuntimeError("Conversion failed")

        # Detect language from audio
        input_lang = detect_input_language(wav_path)
        lang_config = LANGUAGE_MAP.get(input_lang, LANGUAGE_MAP['en'])
        print(f"Detected language: {lang_config['name']} ({input_lang})")

        # Transcribe
        result = whisper_model.transcribe(wav_path, language=input_lang)
        raw_text = re.sub(r'[^\w\s.,!?\'-]', '', result["text"]).strip()
        
        if not raw_text:
            raise ValueError("No speech detected")

        # Generate response in the same language
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "HTTP-Referer": "http://localhost:5000",
                "X-Title": "Voice Assistant"
            },
            json={
                "model": "google/gemma-3-4b-it",
                "messages": [
                    {
                        "role": "system",
                        "content": f"You are a helpful assistant. Respond in {lang_config['name']}. "
                                  "Keep responses under 30 seconds when spoken."
                    },
                    {"role": "user", "content": raw_text}
                ],
                "max_tokens": 150
            },
            timeout=15
        ).json()['choices'][0]['message']['content']

        # Generate audio in the correct language
        try:
            tts = gTTS(text=response, lang=lang_config['tts_lang'])
            tts.save(output_path)
            os.chmod(output_path, 0o777)
        except Exception as e:
            print(f"TTS error for {lang_config['name']}: {e}")
            # Fallback to English
            tts = gTTS(text=response, lang='en')
            tts.save(output_path)
            os.chmod(output_path, 0o777)
            lang_config = LANGUAGE_MAP['en']

        # Verify duration
        try:
            result = subprocess.run([
                "ffprobe", "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                output_path
            ], capture_output=True, text=True)
            duration = float(result.stdout.strip())
            if duration > 30:
                # Generate shorter response in the same language
                short_response = {
                    'en': "Response too long.",
                    'hi': "उत्तर बहुत लंबा है।"
                }.get(lang_config['tts_lang'], "Response too long.")
                
                tts = gTTS(text=short_response, lang=lang_config['tts_lang'])
                tts.save(output_path)
                response = short_response
        except Exception as e:
            print(f"Duration check failed: {e}")

        return jsonify({
            "text": response,
            "audio": f"/audio/{timestamp}",
            "language": lang_config['tts_lang']
        })

    except Exception as e:
        print(f"ERROR: {str(e)}")
        # Clean up files
        for path in [webm_path, wav_path, output_path]:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except:
                pass
        return jsonify({"error": str(e)}), 500

@app.route("/audio/<timestamp>")
def serve_audio(timestamp):
    output_path = os.path.join(STATIC_FOLDER, f"output_{timestamp}.mp3")
    if not os.path.exists(output_path):
        return jsonify({"error": "Audio not found"}), 404
    return send_file(output_path, mimetype="audio/mp3")

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)