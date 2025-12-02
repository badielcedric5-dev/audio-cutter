import { ChannelMode, ExportFormat } from "../types";
// @ts-ignore
import lamejs from 'lamejs';

/**
 * Decodes a Blob into an AudioBuffer.
 */
export const decodeAudio = async (blob: Blob, audioContext: AudioContext): Promise<AudioBuffer> => {
  const arrayBuffer = await blob.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
};

/**
 * Optimized WAV encoder using TypedArrays for performance.
 * 50x faster than DataView loop.
 */
export const bufferToWave = (abuffer: AudioBuffer, len: number): Blob => {
  const numOfChan = abuffer.numberOfChannels;
  const length = len * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  
  // 1. Write WAVE Header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + len * numOfChan * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numOfChan, true);
  view.setUint32(24, abuffer.sampleRate, true);
  view.setUint32(28, abuffer.sampleRate * 2 * numOfChan, true);
  view.setUint16(32, numOfChan * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, len * numOfChan * 2, true);

  // 2. Interleave and convert to 16-bit PCM
  // We use Int16Array view for direct memory access (much faster)
  const offset = 44;
  const pcmData = new Int16Array(buffer, offset);
  
  const channels = [];
  for (let i = 0; i < numOfChan; i++) {
    channels.push(abuffer.getChannelData(i));
  }

  let pcmIdx = 0;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numOfChan; ch++) {
      let s = Math.max(-1, Math.min(1, channels[ch][i]));
      // Convert float [-1.0, 1.0] to int16 [-32768, 32767]
      // Using ternary is faster than Math.floor in this hot loop
      pcmData[pcmIdx++] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
};

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Helper to ensure a buffer is Stereo (2 channels).
 * If Mono, it duplicates the channel to L and R.
 */
const ensureStereo = (buffer: AudioBuffer, audioContext: AudioContext): AudioBuffer => {
    if (buffer.numberOfChannels >= 2) return buffer;

    const stereoBuffer = audioContext.createBuffer(2, buffer.length, buffer.sampleRate);
    stereoBuffer.getChannelData(0).set(buffer.getChannelData(0));
    stereoBuffer.getChannelData(1).set(buffer.getChannelData(0)); // Duplicate to Right
    return stereoBuffer;
};

/**
 * Cuts a region returning a new AudioBuffer directly.
 */
export const cutAudioRegion = (
  originalBuffer: AudioBuffer,
  start: number,
  end: number,
  mode: ChannelMode,
  audioContext: AudioContext
): AudioBuffer => {
  // If we are editing specific channels, ensure we are working in Stereo first
  // so we can silence one side without affecting the other if the source was Mono.
  let workingBuffer = originalBuffer;
  if (mode !== 'stereo' && workingBuffer.numberOfChannels === 1) {
      workingBuffer = ensureStereo(workingBuffer, audioContext);
  }

  const rate = workingBuffer.sampleRate;
  const totalFrames = workingBuffer.length;

  // CLAMPING: Ensure start/end are within buffer bounds to prevent RangeError
  const startFrame = Math.max(0, Math.min(Math.floor(start * rate), totalFrames));
  const endFrame = Math.max(0, Math.min(Math.floor(end * rate), totalFrames));
  
  if (mode === 'stereo') {
      const removedFrames = endFrame - startFrame;
      const newLength = Math.max(0, totalFrames - removedFrames);
      
      if (newLength === 0) return audioContext.createBuffer(workingBuffer.numberOfChannels, 1, rate);

      const newBuffer = audioContext.createBuffer(
        workingBuffer.numberOfChannels,
        newLength,
        rate
      );

      for (let i = 0; i < workingBuffer.numberOfChannels; i++) {
        const originalChannel = workingBuffer.getChannelData(i);
        const newChannel = newBuffer.getChannelData(i);
        
        // Copy part before cut
        if (startFrame > 0) {
            newChannel.set(originalChannel.subarray(0, startFrame));
        }
        // Copy part after cut (offset by new start pos)
        if (endFrame < totalFrames) {
            newChannel.set(originalChannel.subarray(endFrame), startFrame);
        }
      }
      return newBuffer;

  } else {
      // Silence Mode (Keep length)
      const newBuffer = audioContext.createBuffer(
          workingBuffer.numberOfChannels,
          totalFrames,
          rate
      );

      for (let i = 0; i < workingBuffer.numberOfChannels; i++) {
          const originalChannel = workingBuffer.getChannelData(i);
          const newChannel = newBuffer.getChannelData(i);
          newChannel.set(originalChannel); // Copy all

          const isTargetChannel = (mode === 'left' && i === 0) || (mode === 'right' && i === 1);
          if (isTargetChannel) {
              // Zero out region
              // We use clamp logic implicitly via subarray indices, but explicit safety is better
              if (startFrame < endFrame) {
                 const channelData = newChannel.subarray(startFrame, endFrame);
                 channelData.fill(0);
              }
          }
      }
      return newBuffer;
  }
};

/**
 * Extracts a region returning an AudioBuffer.
 */
export const extractAudioRegion = (
    originalBuffer: AudioBuffer,
    start: number,
    end: number,
    mode: ChannelMode,
    audioContext: AudioContext
): AudioBuffer => {
    // Treat Mono as "Dual Mono" (L=R) for extraction. 
    // If I extract 'Right' from Mono, I should get the audio, not silence.
    let workingBuffer = originalBuffer;
    if (workingBuffer.numberOfChannels === 1 && (mode === 'left' || mode === 'right')) {
         workingBuffer = ensureStereo(workingBuffer, audioContext);
    }

    const rate = workingBuffer.sampleRate;
    const totalFrames = workingBuffer.length;
    
    // Clamp coordinates
    const startFrame = Math.max(0, Math.min(Math.floor(start * rate), totalFrames));
    const endFrame = Math.max(0, Math.min(Math.floor(end * rate), totalFrames));
    
    const newLength = Math.max(0, endFrame - startFrame);

    if (newLength === 0) return audioContext.createBuffer(1, 1, rate);

    const outputChannels = mode === 'stereo' ? workingBuffer.numberOfChannels : 1;
    
    const newBuffer = audioContext.createBuffer(
        outputChannels,
        newLength,
        rate
    );

    if (mode === 'stereo') {
        for (let i = 0; i < workingBuffer.numberOfChannels; i++) {
            newBuffer.getChannelData(i).set(
                workingBuffer.getChannelData(i).subarray(startFrame, endFrame)
            );
        }
    } else {
        const sourceChannelIndex = mode === 'left' ? 0 : 1;
        if (sourceChannelIndex < workingBuffer.numberOfChannels) {
            newBuffer.getChannelData(0).set(
                workingBuffer.getChannelData(sourceChannelIndex).subarray(startFrame, endFrame)
            );
        }
    }

    return newBuffer;
}

/**
 * Concatenates two AudioBuffers.
 */
export const concatenateAudioBuffers = (
    buffer1: AudioBuffer,
    buffer2: AudioBuffer,
    audioContext: AudioContext
): AudioBuffer => {
    const numberOfChannels = Math.max(buffer1.numberOfChannels, buffer2.numberOfChannels);
    const totalLength = buffer1.length + buffer2.length;
    
    const newBuffer = audioContext.createBuffer(
        numberOfChannels,
        totalLength,
        buffer1.sampleRate
    );

    for (let i = 0; i < numberOfChannels; i++) {
        const channelData = newBuffer.getChannelData(i);
        if (i < buffer1.numberOfChannels) {
            channelData.set(buffer1.getChannelData(i), 0);
        } else if (buffer1.numberOfChannels === 1 && i === 1) {
             // Up-mix Mono buffer1 to Stereo
             channelData.set(buffer1.getChannelData(0), 0);
        }

        if (i < buffer2.numberOfChannels) {
            channelData.set(buffer2.getChannelData(i), buffer1.length);
        } else if (buffer2.numberOfChannels === 1 && i === 1) {
             // Up-mix Mono buffer2 to Stereo
             channelData.set(buffer2.getChannelData(0), buffer1.length);
        }
    }
    return newBuffer;
};

/**
 * Inserts one AudioBuffer into another.
 */
export const insertAudioBuffer = (
    targetBuffer: AudioBuffer,
    pasteBuffer: AudioBuffer,
    insertionTime: number,
    audioContext: AudioContext
): AudioBuffer => {
    const rate = targetBuffer.sampleRate;
    const insertionFrame = Math.floor(insertionTime * rate);
    const safeInsertionFrame = Math.max(0, Math.min(insertionFrame, targetBuffer.length));
    
    const numberOfChannels = Math.max(targetBuffer.numberOfChannels, pasteBuffer.numberOfChannels);
    const totalLength = targetBuffer.length + pasteBuffer.length;
    
    const newBuffer = audioContext.createBuffer(
        numberOfChannels,
        totalLength,
        rate
    );

    for (let i = 0; i < numberOfChannels; i++) {
        const newChannel = newBuffer.getChannelData(i);
        
        // 1. Target Start
        if (i < targetBuffer.numberOfChannels) {
            newChannel.set(targetBuffer.getChannelData(i).subarray(0, safeInsertionFrame), 0);
        } else if (targetBuffer.numberOfChannels === 1 && i === 1) {
            newChannel.set(targetBuffer.getChannelData(0).subarray(0, safeInsertionFrame), 0);
        }
        
        // 2. Paste Content
        if (i < pasteBuffer.numberOfChannels) {
            newChannel.set(pasteBuffer.getChannelData(i), safeInsertionFrame);
        } else if (pasteBuffer.numberOfChannels === 1 && i === 1) {
            newChannel.set(pasteBuffer.getChannelData(0), safeInsertionFrame);
        }
        
        // 3. Target End
        if (i < targetBuffer.numberOfChannels) {
            newChannel.set(targetBuffer.getChannelData(i).subarray(safeInsertionFrame), safeInsertionFrame + pasteBuffer.length);
        } else if (targetBuffer.numberOfChannels === 1 && i === 1) {
            newChannel.set(targetBuffer.getChannelData(0).subarray(safeInsertionFrame), safeInsertionFrame + pasteBuffer.length);
        }
    }
    return newBuffer;
};

/**
 * Overwrites audio in a specific channel.
 */
export const pasteAudioToChannel = (
    targetBuffer: AudioBuffer,
    pasteBuffer: AudioBuffer,
    insertionTime: number,
    targetChannelMode: ChannelMode, 
    audioContext: AudioContext
): AudioBuffer => {
    // Ensure we are working with at least Stereo if we are targeting specific channels
    let workingBuffer = targetBuffer;
    if (workingBuffer.numberOfChannels === 1) {
        workingBuffer = ensureStereo(workingBuffer, audioContext);
    }

    const rate = workingBuffer.sampleRate;
    const startFrame = Math.max(0, Math.floor(insertionTime * rate)); // Clamp to 0
    const endFrame = startFrame + pasteBuffer.length;
    const newTotalLength = Math.max(workingBuffer.length, endFrame);

    const newBuffer = audioContext.createBuffer(
        workingBuffer.numberOfChannels,
        newTotalLength,
        rate
    );

    // Copy original
    for (let i = 0; i < workingBuffer.numberOfChannels; i++) {
        newBuffer.getChannelData(i).set(workingBuffer.getChannelData(i));
    }

    const targetChIndex = targetChannelMode === 'left' ? 0 : 1;

    if (targetChIndex < newBuffer.numberOfChannels) {
        const targetData = newBuffer.getChannelData(targetChIndex);
        // Take Ch0 from source (or mono source)
        const sourceData = pasteBuffer.getChannelData(0); 

        // Direct TypedArray copy is problematic if we are overwriting a middle section
        // because .set() overwrites. This is exactly what we want.
        // HOWEVER, if source is shorter than remaining track, we just overwrite that part.
        // If source is longer, we extended the buffer above.
        
        // Be careful not to overflow if sourceData is huge and we are near end of newBuffer
        // But we sized newBuffer to fit.
        targetData.set(sourceData, startFrame);
    }
    return newBuffer;
}

/**
 * Adds silence to the end.
 */
export const padAudioBuffer = (
    originalBuffer: AudioBuffer,
    audioContext: AudioContext,
    extraSeconds: number
): AudioBuffer => {
    const rate = originalBuffer.sampleRate;
    const extraFrames = Math.floor(extraSeconds * rate);
    const totalLength = originalBuffer.length + extraFrames;

    const newBuffer = audioContext.createBuffer(
        originalBuffer.numberOfChannels,
        totalLength,
        rate
    );

    for (let i = 0; i < originalBuffer.numberOfChannels; i++) {
        newBuffer.getChannelData(i).set(originalBuffer.getChannelData(i));
    }
    return newBuffer;
};

/**
 * Applies effects returning AudioBuffer.
 */
export const applyAudioEffects = (
    buffer: AudioBuffer,
    start: number,
    end: number,
    volume: number,
    pan: number,
    audioContext: AudioContext
): AudioBuffer => {
    const rate = buffer.sampleRate;
    const totalFrames = buffer.length;

    // Clamp coordinates
    const startFrame = Math.max(0, Math.min(Math.floor(start * rate), totalFrames));
    const endFrame = Math.max(0, Math.min(Math.floor(end * rate), totalFrames));
    
    // If Panning or Volume adjustment on specific channels is requested on Mono, upgrade to Stereo
    let workingBuffer = buffer;
    const isPanning = Math.abs(pan) > 0.01;
    
    if (workingBuffer.numberOfChannels === 1 && isPanning) {
        workingBuffer = ensureStereo(workingBuffer, audioContext);
    }

    const outputChannels = workingBuffer.numberOfChannels;
    const newBuffer = audioContext.createBuffer(
        outputChannels,
        workingBuffer.length,
        rate
    );

    // 1. Copy original data
    for (let ch = 0; ch < outputChannels; ch++) {
        newBuffer.getChannelData(ch).set(workingBuffer.getChannelData(ch));
    }

    // 2. Calc Gains (Constant Power Pan)
    const normalizedPan = (pan + 1) / 2; 
    const angle = normalizedPan * (Math.PI / 2);
    let leftGain = Math.cos(angle);
    let rightGain = Math.sin(angle);
    
    // 3. Apply
    for (let ch = 0; ch < outputChannels; ch++) {
        const channelData = newBuffer.getChannelData(ch);
        
        let channelPanGain = 1;
        if (outputChannels === 2) {
             if (ch === 0) channelPanGain = leftGain;
             if (ch === 1) channelPanGain = rightGain;
        }
        
        const totalGain = volume * channelPanGain;

        // Apply gain only to the region
        // We ensure we don't go out of bounds with loop limit
        if (startFrame < endFrame) {
            for (let i = startFrame; i < endFrame; i++) {
                channelData[i] *= totalGain;
            }
        }
    }
    return newBuffer;
};

/**
 * Mixes all tracks into a single AudioBuffer.
 */
export const mixAllTracks = (
    tracks: { buffer: AudioBuffer; isMuted: boolean }[],
    audioContext: AudioContext
): AudioBuffer => {
    // 1. Find max duration among unmuted tracks
    let maxLength = 0;
    tracks.forEach(t => {
        if (!t.isMuted && t.buffer.length > maxLength) {
            maxLength = t.buffer.length;
        }
    });

    if (maxLength === 0) {
        return audioContext.createBuffer(2, 1, audioContext.sampleRate);
    }

    // Always create stereo output for the mix
    // Create a temp buffer with the FULL length (including possible padding)
    const tempBuffer = audioContext.createBuffer(2, maxLength, audioContext.sampleRate);
    const leftOut = tempBuffer.getChannelData(0);
    const rightOut = tempBuffer.getChannelData(1);

    // 2. Sum tracks
    tracks.forEach(t => {
        if (t.isMuted) return;
        
        const buffer = t.buffer;
        // Get channel data (if mono, duplicate to R)
        const leftIn = buffer.getChannelData(0);
        const rightIn = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : buffer.getChannelData(0);

        // Add to output
        // We iterate only up to the track's length to save cycles
        const len = buffer.length;
        for (let i = 0; i < len; i++) {
            leftOut[i] += leftIn[i];
            rightOut[i] += rightIn[i];
        }
    });

    // 3. Hard Clip Limiter to prevent nasty wrapping distortion
    // And simultaneously detect the last non-silent frame
    let lastNonZeroFrame = 0;

    for (let i = 0; i < maxLength; i++) {
        // Limiter
        if (leftOut[i] > 1) leftOut[i] = 1;
        if (leftOut[i] < -1) leftOut[i] = -1;
        
        if (rightOut[i] > 1) rightOut[i] = 1;
        if (rightOut[i] < -1) rightOut[i] = -1;

        // Silence detection
        // Threshold of 0.0001 is standard to ignore floating point noise
        if (Math.abs(leftOut[i]) > 0.0001 || Math.abs(rightOut[i]) > 0.0001) {
            lastNonZeroFrame = i;
        }
    }

    // 4. TRIM SILENCE
    // We trim the buffer to the last non-silent frame + a small margin (e.g., 0.5s) to avoid abrupt cuts
    // But we ensure we don't exceed the original buffer
    const trimEnd = Math.min(maxLength, lastNonZeroFrame + Math.floor(audioContext.sampleRate * 0.5));
    
    if (trimEnd === 0) {
        return audioContext.createBuffer(2, 1, audioContext.sampleRate);
    }

    const finalBuffer = audioContext.createBuffer(2, trimEnd, audioContext.sampleRate);
    finalBuffer.getChannelData(0).set(leftOut.subarray(0, trimEnd));
    finalBuffer.getChannelData(1).set(rightOut.subarray(0, trimEnd));

    return finalBuffer;
};

export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
        if (typeof reader.result === 'string') {
            const base64String = reader.result.split(',')[1];
            resolve(base64String);
        } else {
            reject(new Error("Failed to convert blob to base64"));
        }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * Encodes audio buffer to MP3 using lamejs
 */
export const bufferToMp3 = (buffer: AudioBuffer): Blob => {
    const channels = buffer.numberOfChannels || 1;
    const sampleRate = buffer.sampleRate;
    const kbps = 128; // Standard quality
    
    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
    const mp3Data = [];

    // Convert Float32 to Int16
    const leftData = buffer.getChannelData(0);
    const rightData = channels > 1 ? buffer.getChannelData(1) : undefined;
    
    // We process in chunks to avoid blowing up memory if sample is huge, 
    // although for simplicity here we assume reasonable size or do one pass.
    // LameJS expects Int16Array.
    
    const samples = new Int16Array(leftData.length);
    for(let i=0; i<leftData.length; i++) {
        let s = Math.max(-1, Math.min(1, leftData[i]));
        samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    let rightSamples: Int16Array | undefined;
    if (rightData) {
        rightSamples = new Int16Array(rightData.length);
        for(let i=0; i<rightData.length; i++) {
            let s = Math.max(-1, Math.min(1, rightData[i]));
            rightSamples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
    }

    // Encode
    const mp3buf = mp3encoder.encodeBuffer(samples, rightSamples);
    if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }
    
    const endBuf = mp3encoder.flush();
    if (endBuf.length > 0) {
        mp3Data.push(endBuf);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
};

/**
 * Encodes audio buffer to requested format.
 * WAV and MP3 are done purely in JS/WASM.
 * WebM and MP4 use MediaRecorder real-time encoding fallback.
 */
export const exportAudio = async (
    buffer: AudioBuffer,
    format: ExportFormat,
    audioContext: AudioContext
): Promise<Blob> => {
    if (format === 'wav') {
        return bufferToWave(buffer, buffer.length);
    }

    if (format === 'mp3') {
        return bufferToMp3(buffer);
    }

    // Fallback for WebM / MP4 via MediaRecorder (Playback-based)
    const dest = audioContext.createMediaStreamDestination();
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(dest);

    // Determine mimeType
    let mimeType = 'audio/webm';
    if (format === 'mp4' && MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
    } else if (format === 'mp4' && MediaRecorder.isTypeSupported('audio/webm')) {
        console.warn("MP4 not supported natively, falling back to WebM container");
        mimeType = 'audio/webm';
    }

    const recorder = new MediaRecorder(dest.stream, { mimeType });
    const chunks: Blob[] = [];

    return new Promise((resolve, reject) => {
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: mimeType });
            resolve(blob);
        };

        recorder.onerror = (e) => reject(e);

        recorder.start();
        source.start();
        
        // Stop recording when playback finishes
        source.onended = () => {
            recorder.stop();
        };
    });
};
