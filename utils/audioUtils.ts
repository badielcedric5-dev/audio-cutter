/**
 * Decodes a Blob into an AudioBuffer.
 */
export const decodeAudio = async (blob: Blob, audioContext: AudioContext): Promise<AudioBuffer> => {
  const arrayBuffer = await blob.arrayBuffer();
  return await audioContext.decodeAudioData(arrayBuffer);
};

/**
 * Creates a new Blob from an AudioBuffer.
 * This is a simplified WAV encoder for browser usage.
 */
export const bufferToWave = (abuffer: AudioBuffer, len: number): Blob => {
  let numOfChan = abuffer.numberOfChannels,
    length = len * numOfChan * 2 + 44,
    buffer = new ArrayBuffer(length),
    view = new DataView(buffer),
    channels = [],
    i,
    sample,
    offset = 0,
    pos = 0;

  // write WAVE header
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"

  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(abuffer.sampleRate);
  setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this simple encoder)

  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // write interleaved data
  for (i = 0; i < abuffer.numberOfChannels; i++)
    channels.push(abuffer.getChannelData(i));

  while (pos < len) {
    for (i = 0; i < numOfChan; i++) {
      // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
      view.setInt16(44 + offset, sample, true); // write 16-bit sample
      offset += 2;
    }
    pos++;
  }

  return new Blob([buffer], { type: "audio/wav" });

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
};

/**
 * Cuts a region out of an AudioBuffer and returns a new Blob.
 */
export const cutAudioRegion = (
  originalBuffer: AudioBuffer,
  start: number,
  end: number,
  audioContext: AudioContext
): Blob => {
  const rate = originalBuffer.sampleRate;
  const startFrame = Math.floor(start * rate);
  const endFrame = Math.floor(end * rate);
  const totalFrames = originalBuffer.length;
  
  const newLength = totalFrames - (endFrame - startFrame);
  
  if (newLength <= 0) {
     return bufferToWave(originalBuffer, totalFrames);
  }

  const newBuffer = audioContext.createBuffer(
    originalBuffer.numberOfChannels,
    newLength,
    rate
  );

  for (let i = 0; i < originalBuffer.numberOfChannels; i++) {
    const originalChannel = originalBuffer.getChannelData(i);
    const newChannel = newBuffer.getChannelData(i);

    // Copy part before cut
    newChannel.set(originalChannel.subarray(0, startFrame));
    
    // Copy part after cut
    newChannel.set(originalChannel.subarray(endFrame), startFrame);
  }

  return bufferToWave(newBuffer, newLength);
};

/**
 * Extracts a region into a standalone Blob (for AI analysis or export).
 */
export const extractAudioRegion = (
    originalBuffer: AudioBuffer,
    start: number,
    end: number,
    audioContext: AudioContext
): Blob => {
    const rate = originalBuffer.sampleRate;
    const startFrame = Math.floor(start * rate);
    const endFrame = Math.floor(end * rate);
    const newLength = endFrame - startFrame;

    if (newLength <= 0) return new Blob([], { type: 'audio/wav' });

    const newBuffer = audioContext.createBuffer(
        originalBuffer.numberOfChannels,
        newLength,
        rate
    );

    for (let i = 0; i < originalBuffer.numberOfChannels; i++) {
        const originalChannel = originalBuffer.getChannelData(i);
        const newChannel = newBuffer.getChannelData(i);
        newChannel.set(originalChannel.subarray(startFrame, endFrame));
    }

    return bufferToWave(newBuffer, newLength);
}

/**
 * Converts a Blob to a Base64 string.
 */
export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
        if (typeof reader.result === 'string') {
             // Remove data URL part (e.g., "data:audio/wav;base64,")
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