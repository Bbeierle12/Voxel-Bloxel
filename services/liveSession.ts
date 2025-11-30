import { MODELS } from "./geminiService";
import { AI_TOOLS } from "../types";

// ============================================================================
// LIVE SESSION MANAGER - WebSocket-based Multimodal Live API
// ============================================================================

export type LiveSessionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "listening"
  | "speaking"
  | "error";

export interface LiveSessionConfig {
  apiKey: string;
  onStateChange?: (state: LiveSessionState) => void;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onResponse?: (text: string) => void;
  onAudioOutput?: (audioData: ArrayBuffer) => void;
  onToolCall?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onError?: (error: Error) => void;
}

interface ServerMessage {
  setupComplete?: object;
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType: string;
          data: string;
        };
        functionCall?: {
          name: string;
          args: Record<string, unknown>;
        };
      }>;
    };
    turnComplete?: boolean;
  };
  toolCallCancellation?: object;
}

export class LiveSessionManager {
  private ws: WebSocket | null = null;
  private config: LiveSessionConfig;
  private state: LiveSessionState = "disconnected";
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private audioWorklet: AudioWorkletNode | null = null;
  private isRecording = false;

  // Audio playback queue
  private audioQueue: ArrayBuffer[] = [];
  private isPlaying = false;

  constructor(config: LiveSessionConfig) {
    this.config = config;
  }

  // ============================================================================
  // CONNECTION MANAGEMENT
  // ============================================================================

  async connect(): Promise<void> {
    if (this.state === "connected" || this.state === "connecting") {
      return;
    }

    this.setState("connecting");

    try {
      // Create WebSocket connection to Gemini Live API
      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${this.config.apiKey}`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.sendSetupMessage();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (event) => {
        console.error("WebSocket error:", event);
        this.config.onError?.(new Error("WebSocket connection error"));
        this.setState("error");
      };

      this.ws.onclose = () => {
        this.setState("disconnected");
        this.cleanup();
      };
    } catch (error) {
      console.error("Connection error:", error);
      this.setState("error");
      this.config.onError?.(error as Error);
    }
  }

  disconnect(): void {
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }

  private setState(state: LiveSessionState): void {
    this.state = state;
    this.config.onStateChange?.(state);
  }

  getState(): LiveSessionState {
    return this.state;
  }

  // ============================================================================
  // MESSAGE HANDLING
  // ============================================================================

  private sendSetupMessage(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const setupMessage = {
      setup: {
        model: `models/${MODELS.LIVE_AUDIO}`,
        generationConfig: {
          responseModalities: ["AUDIO", "TEXT"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Puck", // Friendly voice
              },
            },
          },
        },
        systemInstruction: {
          parts: [
            {
              text: `You are "The Orb" - an AI entity embodied as a glowing purple orb in a 3D voxel world called Codify.
              
You can help users:
- Build structures by spawning entities
- Write behavior scripts for entities  
- Modify world physics
- Answer questions about the world

Personality:
- Helpful and encouraging
- Slightly mystical/ethereal tone
- Enthusiastic about building and creating
- Speak naturally and conversationally

When you need to perform actions, use the available function tools.`,
            },
          ],
        },
        tools: [
          {
            functionDeclarations: AI_TOOLS.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          },
        ],
      },
    };

    this.ws.send(JSON.stringify(setupMessage));
  }

  private async handleMessage(data: string | Blob): Promise<void> {
    try {
      let message: ServerMessage;

      if (data instanceof Blob) {
        const text = await data.text();
        message = JSON.parse(text);
      } else {
        message = JSON.parse(data);
      }

      // Handle setup complete
      if (message.setupComplete) {
        this.setState("connected");
        await this.initializeAudio();
        return;
      }

      // Handle server content
      if (message.serverContent) {
        const { modelTurn, turnComplete } = message.serverContent;

        if (modelTurn?.parts) {
          for (const part of modelTurn.parts) {
            // Text response
            if (part.text) {
              this.config.onResponse?.(part.text);
            }

            // Audio response
            if (part.inlineData?.mimeType.startsWith("audio/")) {
              const audioData = this.base64ToArrayBuffer(part.inlineData.data);
              this.queueAudio(audioData);
            }

            // Function call
            if (part.functionCall) {
              const result = await this.config.onToolCall?.(
                part.functionCall.name,
                part.functionCall.args
              );
              this.sendToolResponse(part.functionCall.name, result);
            }
          }
        }

        if (turnComplete) {
          this.setState("connected");
        }
      }
    } catch (error) {
      console.error("Message handling error:", error);
    }
  }

  private sendToolResponse(name: string, result: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const response = {
      toolResponse: {
        functionResponses: [
          {
            name,
            response: { result: JSON.stringify(result) },
          },
        ],
      },
    };

    this.ws.send(JSON.stringify(response));
  }

  // ============================================================================
  // AUDIO INPUT/OUTPUT
  // ============================================================================

  private async initializeAudio(): Promise<void> {
    try {
      // Create audio context for playback
      this.audioContext = new AudioContext({ sampleRate: 24000 });

      // Request microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Set up audio processing using ScriptProcessorNode (AudioWorklet preferred but more complex)
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      const processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      processor.onaudioprocess = (e) => {
        if (!this.isRecording) return;

        const inputData = e.inputBuffer.getChannelData(0);
        // Downsample from audioContext.sampleRate to 16000 if needed
        const downsampledData = this.downsample(
          inputData,
          this.audioContext!.sampleRate,
          16000
        );
        const pcm16 = this.floatTo16BitPCM(downsampledData);
        this.sendAudioChunk(pcm16);
      };

      source.connect(processor);
      processor.connect(this.audioContext.destination);
    } catch (error) {
      console.error("Audio initialization error:", error);
      this.config.onError?.(error as Error);
    }
  }

  private downsample(
    buffer: Float32Array,
    fromRate: number,
    toRate: number
  ): Float32Array {
    if (fromRate === toRate) return buffer;

    const ratio = fromRate / toRate;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const index = Math.floor(i * ratio);
      result[i] = buffer[index];
    }

    return result;
  }

  private floatTo16BitPCM(input: Float32Array): ArrayBuffer {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return output.buffer;
  }

  private sendAudioChunk(pcmData: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const base64 = this.arrayBufferToBase64(pcmData);
    const message = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: "audio/pcm;rate=16000",
            data: base64,
          },
        ],
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  private queueAudio(audioData: ArrayBuffer): void {
    this.audioQueue.push(audioData);
    this.config.onAudioOutput?.(audioData);

    if (!this.isPlaying) {
      this.playNextAudio();
    }
  }

  private async playNextAudio(): Promise<void> {
    if (this.audioQueue.length === 0 || !this.audioContext) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    this.setState("speaking");

    const audioData = this.audioQueue.shift()!;

    try {
      // Convert PCM to AudioBuffer
      const audioBuffer = await this.pcmToAudioBuffer(audioData);
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      source.onended = () => {
        this.playNextAudio();
      };

      source.start();
    } catch (error) {
      console.error("Audio playback error:", error);
      this.playNextAudio();
    }
  }

  private async pcmToAudioBuffer(pcmData: ArrayBuffer): Promise<AudioBuffer> {
    const int16Array = new Int16Array(pcmData);
    const floatArray = new Float32Array(int16Array.length);

    for (let i = 0; i < int16Array.length; i++) {
      floatArray[i] = int16Array[i] / 32768;
    }

    const audioBuffer = this.audioContext!.createBuffer(
      1,
      floatArray.length,
      24000
    );
    audioBuffer.getChannelData(0).set(floatArray);

    return audioBuffer;
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  startListening(): void {
    if (this.state !== "connected") return;
    this.isRecording = true;
    this.setState("listening");
  }

  stopListening(): void {
    this.isRecording = false;
    if (this.state === "listening") {
      this.setState("connected");
    }
  }

  sendTextMessage(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      clientContent: {
        turns: [
          {
            role: "user",
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };

    this.ws.send(JSON.stringify(message));
  }

  // ============================================================================
  // UTILITIES
  // ============================================================================

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private cleanup(): void {
    this.isRecording = false;
    this.audioQueue = [];
    this.isPlaying = false;

    if (this.audioWorklet) {
      this.audioWorklet.disconnect();
      this.audioWorklet = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

let liveSessionInstance: LiveSessionManager | null = null;

export const getLiveSession = (config?: LiveSessionConfig): LiveSessionManager => {
  if (!liveSessionInstance && config) {
    liveSessionInstance = new LiveSessionManager(config);
  }
  return liveSessionInstance!;
};

export const destroyLiveSession = (): void => {
  if (liveSessionInstance) {
    liveSessionInstance.disconnect();
    liveSessionInstance = null;
  }
};
