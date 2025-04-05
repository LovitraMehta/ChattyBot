# ChattyBot
A multilingual voice assistant (English/Hindi) using Flask, Whisper (speech-to-text), and OpenRouter's Gemma 3.4B (AI responses). Converts speech → text → AI reply → spoken response via gTTS. Features auto language detection, silence handling, WebM/WAV conversion, and file cleanup. Lightweight, responsive, and deployable with error recovery.

#Multilingual Voice Assistant
A real-time voice assistant web application that supports English and Hindi languages, featuring automatic speech recognition, AI-powered responses, and text-to-speech capabilities.

#Features
Multilingual Support: Automatically detects and processes English and Hindi speech
Speech Recognition: Utilizes OpenAI's Whisper model for accurate speech-to-text conversion
AI Responses: Generates intelligent responses using OpenRouter's Gemma 3.4B model
Voice Feedback: Converts text responses to natural speech using Google's gTTS
Smart Recording: Automatically stops recording after 2 seconds of silence
Efficient Processing: Optimized audio pipeline converting WebM to WAV to MP3
Automatic Cleanup: Regularly deletes temporary audio files to save space

#Technology Stack
Backend: Python with Flask framework
Speech Recognition: OpenAI Whisper (base model)
AI Engine: OpenRouter API with Gemma 3.4B model\
Text-to-Speech: Google Text-to-Speech (gTTS)
Audio Processing: FFmpeg for format conversion
Frontend: Vanilla JavaScript with Web Audio API

#Installation
Prerequisites
Python 3.8 or later
FFmpeg (install via sudo apt install ffmpeg on Ubuntu/Debian)

#Setup Instructions

##Clone the repository:
git clone https://github.com/yourusername/voice-assistant.git
cd voice-assistant

##Install Python dependencies:
pip install -r requirements.txt

##Run the application:
python app.py
Access the application at: http://localhost:5000

#How It Works
The application follows this workflow:
User speaks into the microphone (browser records audio in WebM format)
Audio is sent to the backend and converted to WAV using FFmpeg
Whisper model detects language (English/Hindi) and transcribes the speech
Transcription is sent to OpenRouter's Gemma 3.4B model for response generation
Response text is converted to speech using gTTS
Audio response is sent back to the browser for playback

#File Structure
voice-assistant/
├── app.py                # Main Flask application
├── static/               # Output audio files (auto-cleaned)
├── uploads/              # Temporary input audio (auto-cleaned)
├── templates/
│   └── index.html        # Frontend interface
├── script.js             # Client-side functionality
└── requirements.txt      # Python dependencies

#API Endpoints
POST /process_audio: Processes uploaded audio file
Returns JSON: {"text": "response text", "audio": "/audio/timestamp", "language": "en/hi"}

GET /audio/<timestamp>: Streams generated MP3 response

#Configuration
Key configuration options in app.py:
OPENROUTER_API_KEY: Your OpenRouter API key
UPLOAD_FOLDER: Location for temporary audio files
STATIC_FOLDER: Location for output MP3 files
LANGUAGE_MAP: Supported languages and their configurations

#Limitations
Currently supports only English and Hindi
Requires internet connection for OpenRouter and gTTS services
Maximum 30 seconds recording/response duration
Audio quality depends on microphone input
