let mediaRecorder;
let audioChunks = [];
let isConversationActive = false;
let isProcessing = false;
let audioContext;
let audioStream;
let currentAudio;
let restartTimeout;

// Configuration
const CONFIG = {
    SILENCE_THRESHOLD: 2000,    // 2 seconds of silence to stop
    SPEECH_THRESHOLD: 0.02,     // Audio level threshold for speech detection
    MAX_RECORD_TIME: 30000,     // 30s maximum recording
    RETRY_DELAY: 1000,          // 1s delay between retries
    MAX_RESPONSE_DURATION: 30   // 30 seconds maximum response duration
};

// DOM Elements
const elements = {
    status: document.getElementById('status'),
    listeningIndicator: document.getElementById('listening-indicator'),
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn'),
    responseText: document.getElementById('response-text'),
    debugConsole: document.getElementById('debug-console')
};

// Debug logging
function logDebug(message) {
    const entry = document.createElement('div');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    elements.debugConsole.prepend(entry);
    console.log(message);
}

// Initialize audio system
async function initializeAudio() {
    try {
        logDebug('Initializing audio system...');
        audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1
            }
        });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        logDebug('Audio system initialized successfully');
        return true;
    } catch (err) {
        logDebug(`Audio initialization failed: ${err.message}`);
        updateStatus("Microphone access denied");
        return false;
    }
}

// Event Listeners
elements.startBtn.addEventListener('click', startConversation);
elements.stopBtn.addEventListener('click', endConversation);

// Main conversation control
async function startConversation() {
    if (isConversationActive) return;
    
    logDebug('Starting conversation...');
    isConversationActive = true;
    toggleButtons(true);
    updateStatus("Initializing...");
    elements.responseText.textContent = '';
    
    if (await initializeAudio()) {
        startRecording();
    } else {
        endConversation();
    }
}

function endConversation() {
    if (!isConversationActive) return;
    
    logDebug('Ending conversation...');
    isConversationActive = false;
    isProcessing = false;
    
    // Clean up resources
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    if (audioStream) {
        audioStream.getTracks().forEach(track => track.stop());
        audioStream = null;
    }
    
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    
    clearTimeout(restartTimeout);
    
    // Reset state
    audioChunks = [];
    toggleButtons(false);
    updateStatus("Ready to start");
    updateListeningUI(false);
}

// Recording functions
function startRecording() {
    if (!isConversationActive || isProcessing || !audioStream) return;
    
    logDebug('Starting recording...');
    mediaRecorder = new MediaRecorder(audioStream);
    audioChunks = [];
    
    let silenceTimer;
    let recordingTimer;
    
    // Setup silence detection
    const audioProcessor = audioContext.createScriptProcessor(2048, 1, 1);
    const source = audioContext.createMediaStreamSource(audioStream);
    source.connect(audioProcessor);
    audioProcessor.connect(audioContext.destination);
    
    audioProcessor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        const rms = Math.sqrt(input.reduce((sum, x) => sum + x * x, 0) / input.length);
        
        if (rms > CONFIG.SPEECH_THRESHOLD) {
            clearTimeout(silenceTimer);
            updateStatus("Listening...");
            updateListeningUI(true);
            silenceTimer = setTimeout(() => {
                if (mediaRecorder.state === 'recording') {
                    logDebug('Silence detected, stopping recording');
                    mediaRecorder.stop();
                    updateStatus("Processing...");
                    updateListeningUI(false);
                }
            }, CONFIG.SILENCE_THRESHOLD);
        }
    };
    
    // Safety timeout
    recordingTimer = setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
            logDebug('Max recording time reached, stopping recording');
            mediaRecorder.stop();
            updateStatus("Maximum recording time reached");
        }
    }, CONFIG.MAX_RECORD_TIME);
    
    // MediaRecorder handlers
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
            audioChunks.push(e.data);
        }
    };
    
    mediaRecorder.onstop = async () => {
        clearTimeout(recordingTimer);
        clearTimeout(silenceTimer);
        audioProcessor.disconnect();
        
        if (audioChunks.length > 0) {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
            await processAudioWithRetry(audioBlob);
        }
        
        // Auto-restart if conversation is still active
        if (isConversationActive && !isProcessing) {
            logDebug('Auto-restarting recording');
            restartTimeout = setTimeout(startRecording, 500);
        }
    };
    
    mediaRecorder.start(250);
    updateStatus("Ready for voice input");
    updateListeningUI(true);
}

// Audio processing with retry logic
async function processAudioWithRetry(audioBlob, attempt = 1) {
    if (isProcessing) return;
    isProcessing = true;
    
    try {
        logDebug(`Processing audio (attempt ${attempt})...`);
        updateStatus(`Processing (attempt ${attempt})...`);
        
        const formData = new FormData();
        formData.append('audio', audioBlob, `recording_${Date.now()}.webm`);
        
        const response = await fetch('/process_audio', {
            method: 'POST',
            body: formData
        });
        
        const data = await response.json();
        
        // Handle profanity detection
        if (data.contains_profanity) {
            logDebug('Profanity detected in input');
            updateStatus("Please be respectful");
            elements.responseText.textContent = data.error;
            showProfanityWarning();
            return;
        }
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        elements.responseText.textContent = data.text;
        logDebug(`Received response: ${data.text.substring(0, 50)}...`);
        
        // Add cache-busting parameter
        const audioUrl = `${data.audio}?t=${Date.now()}`;
        await playAudioResponse(audioUrl, data.text);
    } catch (error) {
        logDebug(`Processing failed: ${error.message}`);
        
        if (attempt < 3) {
            updateStatus(`Retrying... (${attempt}/3)`);
            await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY * attempt));
            return processAudioWithRetry(audioBlob, attempt + 1);
        } else {
            updateStatus("Processing failed");
            elements.responseText.textContent = "Error processing request. Please try again.";
        }
    } finally {
        isProcessing = false;
    }
}

// Show profanity warning
function showProfanityWarning() {
    const warning = document.createElement('div');
    warning.className = 'profanity-warning';
    warning.innerHTML = `
        <div class="warning-content">
            <p>⚠️ Please keep the conversation respectful.</p>
            <button onclick="this.parentElement.parentElement.remove()">OK</button>
        </div>
    `;
    document.body.appendChild(warning);
    
    // Auto-restart after warning
    if (isConversationActive && !isProcessing) {
        logDebug('Restarting after profanity warning');
        restartTimeout = setTimeout(startRecording, 2000);
    }
}

// Audio playback with robust handling
async function playAudioResponse(audioUrl, text) {
    return new Promise((resolve) => {
        logDebug(`Starting audio playback from: ${audioUrl}`);
        
        // Clean up previous audio
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.src = '';
            currentAudio = null;
        }
        
        currentAudio = new Audio();
        currentAudio.src = audioUrl;
        
        // Event listeners
        currentAudio.addEventListener('loadedmetadata', () => {
            const duration = currentAudio.duration;
            logDebug(`Audio duration: ${duration.toFixed(2)}s`);
            
            if (duration > CONFIG.MAX_RESPONSE_DURATION) {
                logDebug('Response too long, cancelling playback');
                currentAudio.src = '';
                updateStatus("Response too long - please ask a shorter question");
                elements.responseText.textContent = "Response too long. Please ask a more specific question.";
                resolve();
                return;
            }
            
            updateStatus(`AI is speaking (${Math.ceil(duration)}s)...`);
        });
        
        currentAudio.addEventListener('canplaythrough', () => {
            currentAudio.play().catch(err => {
                logDebug(`Playback failed: ${err.message}`);
                resolve();
            });
        });
        
        currentAudio.addEventListener('ended', () => {
            logDebug('Audio playback completed');
            updateStatus("Ready for response");
            resolve();
            restartIfActive();
        });
        
        currentAudio.addEventListener('error', (err) => {
            logDebug(`Playback error: ${err.message}`);
            updateStatus("Playback failed");
            resolve();
            restartIfActive();
        });
    });
}

function restartIfActive() {
    if (isConversationActive && !isProcessing) {
        logDebug('Restarting recording');
        restartTimeout = setTimeout(startRecording, 500);
    }
}

// UI Helpers
function toggleButtons(conversationActive) {
    elements.startBtn.disabled = conversationActive;
    elements.stopBtn.disabled = !conversationActive;
}

function updateStatus(text) {
    elements.status.textContent = `Status: ${text}`;
}

function updateListeningUI(active) {
    elements.listeningIndicator.style.display = active ? 'block' : 'none';
    elements.listeningIndicator.textContent = active ? '🎤 Listening...' : '';
}

// Initialize
updateStatus("Press Start to begin");
logDebug('Application initialized');