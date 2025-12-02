import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Activity, Plus, Music, Download, Settings, FileAudio } from 'lucide-react';
import WaveformEditor, { WaveformEditorRef } from './components/WaveformEditor';
import { decodeAudio, cutAudioRegion, extractAudioRegion, blobToBase64, concatenateAudioBuffers, insertAudioBuffer, pasteAudioToChannel, padAudioBuffer, bufferToWave, applyAudioEffects, mixAllTracks, exportAudio } from './utils/audioUtils';
import { Track, ChannelMode, ExportFormat } from './types';

const WORKSPACE_PADDING_SECONDS = 300; 

function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wav');
  
  const [focusedTrackId, setFocusedTrackId] = useState<string | null>(null);
  
  // Clipboard now stores AudioBuffer for speed
  const [clipboardBuffer, setClipboardBuffer] = useState<AudioBuffer | null>(null);

  const [recordingTrackId, setRecordingTrackId] = useState<string | null>(null);
  
  // Use Refs for critical recording data to avoid stale closures in onstop callback
  const recordingStartTimeRef = useRef<number>(0);
  const recordingChannelModeRef = useRef<ChannelMode>('stereo');
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const audioContextRef = useRef<AudioContext | null>(null);

  const trackRefs = useRef<Map<string, WaveformEditorRef>>(new Map());
  const addTrackInputRef = useRef<HTMLInputElement>(null);
  const appendTrackInputRef = useRef<HTMLInputElement>(null);
  const appendingTrackIdRef = useRef<string | null>(null);

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  // Helper to update track state efficiently
  const updateTrackBuffer = (trackId: string, newBuffer: AudioBuffer) => {
      // 1. Generate Blob (using fast optimized encoder) for playback
      const newBlob = bufferToWave(newBuffer, newBuffer.length);
      
      setTracks(prev => prev.map(t => 
          t.id === trackId 
              ? { ...t, blob: newBlob, buffer: newBuffer } 
              : t
      ));
  };

  const handleKeyDown = useCallback(async (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') {
        return;
    }

    if (e.code === 'Space') {
        e.preventDefault();
        if (focusedTrackId) {
            trackRefs.current.get(focusedTrackId)?.togglePlay();
        } else if (tracks.length > 0) {
            trackRefs.current.get(tracks[0].id)?.togglePlay();
        }
    }

    if (e.code === 'Delete' || e.code === 'Backspace') {
        if (focusedTrackId) {
            trackRefs.current.get(focusedTrackId)?.deleteSelectedRegion();
        }
    }

    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC') {
        if (focusedTrackId) {
            const editor = trackRefs.current.get(focusedTrackId);
            const selection = editor?.getSelectedRegion();
            const track = tracks.find(t => t.id === focusedTrackId);

            if (selection && track) {
                const ctx = getAudioContext();
                const buffer = extractAudioRegion(track.buffer, selection.start, selection.end, selection.channelMode, ctx);
                setClipboardBuffer(buffer);
                console.log(`Copied ${selection.channelMode} region`);
            }
        }
    }

    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyX') {
         if (focusedTrackId) {
            const editor = trackRefs.current.get(focusedTrackId);
            const selection = editor?.getSelectedRegion();
            const track = tracks.find(t => t.id === focusedTrackId);

            if (selection && track) {
                const ctx = getAudioContext();
                const buffer = extractAudioRegion(track.buffer, selection.start, selection.end, selection.channelMode, ctx);
                setClipboardBuffer(buffer);
                editor?.deleteSelectedRegion();
                console.log("Cut to clipboard");
            }
        }
    }

    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV') {
        if (clipboardBuffer) {
            setIsProcessing(true);
            try {
                const ctx = getAudioContext();
                
                if (focusedTrackId) {
                    const editor = trackRefs.current.get(focusedTrackId);
                    const currentTime = editor?.getCurrentTime() || 0;
                    const targetChannelMode = editor?.getChannelMode() || 'stereo';
                    const targetTrack = tracks.find(t => t.id === focusedTrackId);

                    if (targetTrack) {
                        let newBuffer: AudioBuffer;
                        
                        if (targetChannelMode === 'stereo') {
                            newBuffer = insertAudioBuffer(targetTrack.buffer, clipboardBuffer, currentTime, ctx);
                        } else {
                            newBuffer = pasteAudioToChannel(targetTrack.buffer, clipboardBuffer, currentTime, targetChannelMode, ctx);
                        }

                        const paddedBuffer = padAudioBuffer(newBuffer, ctx, WORKSPACE_PADDING_SECONDS);
                        updateTrackBuffer(focusedTrackId, paddedBuffer);
                    }
                } else {
                    const paddedBuffer = padAudioBuffer(clipboardBuffer, ctx, WORKSPACE_PADDING_SECONDS);
                    const paddedBlob = bufferToWave(paddedBuffer, paddedBuffer.length);
                    
                    const newTrack: Track = {
                        id: crypto.randomUUID(),
                        name: `Coller - ${new Date().toLocaleTimeString()}`,
                        blob: paddedBlob,
                        buffer: paddedBuffer,
                        isMuted: false
                    };
                    setTracks(prev => [...prev, newTrack]);
                    setTimeout(() => setFocusedTrackId(newTrack.id), 100);
                }

            } catch (err) {
                console.error("Paste failed", err);
            } finally {
                setIsProcessing(false);
            }
        }
    }

  }, [focusedTrackId, tracks, clipboardBuffer]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);


  const handleAddTrack = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const ctx = getAudioContext();
      const arrayBuffer = await file.arrayBuffer();
      // DecodeAudioData automatically supports MP3, WAV, OGG, M4A, AAC, etc.
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      const paddedBuffer = padAudioBuffer(decodedBuffer, ctx, WORKSPACE_PADDING_SECONDS);
      const paddedBlob = bufferToWave(paddedBuffer, paddedBuffer.length);

      const newTrack: Track = {
        id: crypto.randomUUID(),
        name: file.name,
        blob: paddedBlob,
        buffer: paddedBuffer,
        isMuted: false
      };

      setTracks(prev => [...prev, newTrack]);
      setFocusedTrackId(newTrack.id);
    } catch (error) {
      console.error("Error adding track:", error);
      alert("Erreur: Format audio non supporté ou fichier corrompu.");
    } finally {
      setIsProcessing(false);
      if (addTrackInputRef.current) addTrackInputRef.current.value = '';
    }
  };

  const handleAppendFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const trackId = appendingTrackIdRef.current;
      const file = event.target.files?.[0];
      
      if (!file || !trackId) return;

      setIsProcessing(true);
      try {
          const ctx = getAudioContext();
          const arrayBuffer = await file.arrayBuffer();
          const newBuffer = await ctx.decodeAudioData(arrayBuffer);

          const targetTrack = tracks.find(t => t.id === trackId);
          if (!targetTrack) throw new Error("Track not found");

          const combinedBuffer = concatenateAudioBuffers(targetTrack.buffer, newBuffer, ctx);
          const paddedBuffer = padAudioBuffer(combinedBuffer, ctx, WORKSPACE_PADDING_SECONDS);
          
          updateTrackBuffer(trackId, paddedBuffer);

      } catch (error) {
          console.error("Error appending audio:", error);
      } finally {
          setIsProcessing(false);
          appendingTrackIdRef.current = null;
          if (appendTrackInputRef.current) appendTrackInputRef.current.value = '';
      }
  };

  const triggerAppend = (trackId: string) => {
      setFocusedTrackId(trackId);
      appendingTrackIdRef.current = trackId;
      appendTrackInputRef.current?.click();
  }

  const handleCutRegion = async (trackId: string, start: number, end: number, mode: ChannelMode) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;
    
    setIsProcessing(true);
    try {
        const ctx = getAudioContext();
        const newBuffer = cutAudioRegion(track.buffer, start, end, mode, ctx);
        updateTrackBuffer(trackId, newBuffer);
    } catch (error) {
        console.error("Cut failed", error);
    } finally {
        setIsProcessing(false);
    }
  };

  const handleApplyEffects = async (trackId: string, start: number, end: number, volume: number, pan: number) => {
      const track = tracks.find(t => t.id === trackId);
      if (!track) return;

      setIsProcessing(true);
      try {
          const ctx = getAudioContext();
          const newBuffer = applyAudioEffects(track.buffer, start, end, volume, pan, ctx);
          updateTrackBuffer(trackId, newBuffer);
      } catch (error) {
          console.error("Effects failed", error);
      } finally {
          setIsProcessing(false);
      }
  };

  const handleRemoveTrack = (trackId: string) => {
      setTracks(prev => prev.filter(t => t.id !== trackId));
      trackRefs.current.delete(trackId);
      if (focusedTrackId === trackId) setFocusedTrackId(null);
  };

  const handleRecordToggle = async (trackId: string, start: number, _end: number | null, mode: ChannelMode) => {
      if (recordingTrackId === trackId) {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
              mediaRecorderRef.current.stop();
          }
          return;
      }

      try {
          setFocusedTrackId(trackId);
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          recordedChunksRef.current = [];

          mediaRecorder.ondataavailable = (event) => {
              if (event.data.size > 0) {
                  recordedChunksRef.current.push(event.data);
              }
          };

          mediaRecorder.onstop = async () => {
              setIsProcessing(true);
              setRecordingTrackId(null);
              stream.getTracks().forEach(track => track.stop());

              try {
                  const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
                  const ctx = getAudioContext();
                  const arrayBuffer = await blob.arrayBuffer();
                  const recordedBuffer = await ctx.decodeAudioData(arrayBuffer);

                  const targetTrack = tracks.find(t => t.id === trackId);
                  
                  // READ FROM REFS to ensure we have the correct start time and mode at the moment of stopping
                  const insertTime = recordingStartTimeRef.current;
                  const insertMode = recordingChannelModeRef.current;

                  if (targetTrack) {
                      let newBuffer: AudioBuffer;
                      
                      if (insertMode === 'stereo') {
                          // Logic for inserting recording into stereo mix (overwrite at position)
                          const rate = targetTrack.buffer.sampleRate;
                          const startFrame = Math.floor(insertTime * rate);
                          const endFrame = startFrame + recordedBuffer.length;
                          const newTotalLength = Math.max(targetTrack.buffer.length, endFrame);
                          
                          // Expand buffer if needed
                          newBuffer = ctx.createBuffer(targetTrack.buffer.numberOfChannels, newTotalLength, rate);
                          
                          // Copy original
                          for(let i=0; i<targetTrack.buffer.numberOfChannels; i++) {
                              newBuffer.getChannelData(i).set(targetTrack.buffer.getChannelData(i));
                          }

                          // Overwrite with recording (handling mono/stereo recording source)
                          for(let i=0; i<targetTrack.buffer.numberOfChannels; i++) {
                              const destData = newBuffer.getChannelData(i);
                              const srcData = recordedBuffer.getChannelData(i % recordedBuffer.numberOfChannels);
                              
                              // Overwrite data
                              for(let j=0; j<recordedBuffer.length; j++) {
                                  destData[startFrame + j] = srcData[j];
                              }
                          }

                      } else {
                          // Use the utility for single channel paste
                          newBuffer = pasteAudioToChannel(targetTrack.buffer, recordedBuffer, insertTime, insertMode, ctx);
                      }

                      const paddedBuffer = padAudioBuffer(newBuffer, ctx, WORKSPACE_PADDING_SECONDS);
                      updateTrackBuffer(trackId, paddedBuffer);
                  }

              } catch (e) {
                  console.error("Processing recording failed", e);
              } finally {
                  setIsProcessing(false);
              }
          };

          // Update Refs BEFORE starting
          recordingStartTimeRef.current = start;
          recordingChannelModeRef.current = mode;

          mediaRecorder.start(100); // Timeslice 100ms
          setRecordingTrackId(trackId);
          
      } catch (err) {
          console.error("Could not start recording", err);
          alert("Impossible d'accéder au microphone.");
      }
  };

  const handleExport = async () => {
    if (tracks.length === 0) return;
    
    // For WAV and MP3, processing is done in JS
    // For WebM/MP4, it involves playback, so we show a dedicated "Exporting" state
    if (exportFormat === 'wav' || exportFormat === 'mp3') {
        setIsProcessing(true);
    } else {
        setIsExporting(true);
    }

    try {
        const ctx = getAudioContext();
        const mixedBuffer = mixAllTracks(tracks, ctx);
        
        let blob: Blob;
        let ext = exportFormat;

        // Use the dedicated export function that handles dispatching
        blob = await exportAudio(mixedBuffer, exportFormat, ctx);
        
        // Browser fallback check for webm vs mp4
        if (exportFormat === 'mp4' && blob.type.includes('webm')) ext = 'webm';
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `projet_audio_${new Date().toISOString().slice(0,10)}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
    } catch(e) {
        console.error("Export failed", e);
        alert("L'exportation a échoué.");
    } finally {
        setIsProcessing(false);
        setIsExporting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-primary/30 pb-20">
      
      {/* Export Loader Overlay */}
      {isExporting && (
          <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center backdrop-blur-sm">
              <div className="bg-surface p-8 rounded-2xl border border-primary/20 shadow-2xl flex flex-col items-center gap-6 max-w-sm text-center">
                  <div className="relative">
                      <div className="w-16 h-16 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
                      <Download className="absolute inset-0 m-auto text-primary" size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white mb-2">Exportation en cours...</h3>
                    <p className="text-gray-400 text-sm">
                        Conversion au format {exportFormat.toUpperCase()}.<br/>
                        Veuillez patienter, cela peut prendre la durée de l'audio.
                    </p>
                  </div>
              </div>
          </div>
      )}

      <input 
          type="file" 
          accept="audio/*" 
          ref={addTrackInputRef}
          onChange={handleAddTrack}
          className="hidden"
      />
      <input 
          type="file" 
          accept="audio/*" 
          ref={appendTrackInputRef}
          onChange={handleAppendFileSelect}
          className="hidden"
      />

      <header className="bg-surface/50 backdrop-blur-md border-b border-secondary sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-primary to-blue-600 p-2 rounded-lg">
                <Activity className="text-white h-6 w-6" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              AudioStudio AI
            </h1>
          </div>
          <div className="flex items-center gap-4">
             {clipboardBuffer && (
                 <span className="text-xs text-green-400 bg-green-500/10 px-2 py-1 rounded hidden sm:inline-block border border-green-500/20">
                     Audio copié
                 </span>
             )}
            {tracks.length > 0 && (
                <div className="flex items-center bg-secondary rounded-full p-0.5 border border-white/10">
                    <div className="relative">
                        <select 
                            value={exportFormat}
                            onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                            className="bg-transparent text-xs text-gray-300 pl-3 pr-8 py-2 outline-none appearance-none cursor-pointer hover:text-white transition-colors uppercase font-bold"
                        >
                            <option value="wav" className="bg-surface text-gray-300">WAV (HQ)</option>
                            <option value="mp3" className="bg-surface text-gray-300">MP3 (Compressed)</option>
                            <option value="mp4" className="bg-surface text-gray-300">MP4 (AAC)</option>
                            <option value="webm" className="bg-surface text-gray-300">WEBM</option>
                        </select>
                        <Settings className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500" size={12} />
                    </div>
                    <button 
                        onClick={handleExport}
                        className="flex items-center gap-2 text-sm bg-primary hover:bg-primary/90 text-white px-4 py-1.5 rounded-full transition shadow-lg"
                        title="Télécharger"
                    >
                        {isProcessing ? (
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                        ) : (
                            <Download size={16} />
                        )}
                        <span className="hidden sm:inline">Exporter</span>
                    </button>
                </div>
            )}
            <button 
                onClick={() => addTrackInputRef.current?.click()}
                className="flex items-center gap-2 text-sm bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-full transition border border-white/5"
            >
                <Plus size={16} />
                Nouvelle Piste
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 flex flex-col gap-8">
        
        {tracks.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-secondary rounded-3xl bg-surface/30 p-12 transition-all hover:border-primary/50 group mt-10">
            <div className="bg-surface p-6 rounded-full mb-6 group-hover:scale-110 transition-transform duration-300 shadow-2xl">
                <Music size={48} className="text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-center">Commencez votre projet</h2>
            <p className="text-gray-400 mb-8 text-center max-w-md">
              Ajoutez votre première piste audio (MP3, WAV, AAC, OGG...) pour commencer l'édition.
              <br/>
              <span className="text-sm mt-2 block text-gray-500">Raccourcis : Espace, Ctrl+C/V/X, Suppr</span>
            </p>
            <button 
                onClick={() => addTrackInputRef.current?.click()}
                className="bg-primary hover:bg-primary/90 text-white px-8 py-3 rounded-full font-medium shadow-lg hover:shadow-primary/25 transition-all flex items-center gap-2"
            >
                <Upload size={18} />
                Ajouter une piste
            </button>
          </div>
        )}

        {tracks.length > 0 && (
          <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            
            <div className="flex flex-col gap-4">
                {tracks.map((track) => (
                    <WaveformEditor 
                        key={track.id}
                        ref={(el) => {
                            if (el) trackRefs.current.set(track.id, el);
                            else trackRefs.current.delete(track.id);
                        }}
                        trackId={track.id}
                        trackName={track.name}
                        audioBlob={track.blob}
                        audioBuffer={track.buffer}
                        onUpdateBlob={() => {}}
                        onCutRegion={(s, e, m) => handleCutRegion(track.id, s, e, m)}
                        onAppendAudio={() => triggerAppend(track.id)}
                        onRemoveTrack={() => handleRemoveTrack(track.id)}
                        onApplyEffects={(s, e, v, p) => handleApplyEffects(track.id, s, e, v, p)}
                        onRecordToggle={(s, e, m) => handleRecordToggle(track.id, s, e, m)}
                        isProcessing={isProcessing}
                        isFocused={focusedTrackId === track.id}
                        onFocus={() => setFocusedTrackId(track.id)}
                        isRecording={recordingTrackId === track.id}
                    />
                ))}

                <button 
                    onClick={() => addTrackInputRef.current?.click()}
                    className="w-full py-4 border-2 border-dashed border-secondary rounded-xl text-gray-400 hover:text-white hover:border-primary/50 hover:bg-surface/50 transition-all flex items-center justify-center gap-2"
                >
                    <Plus size={20} />
                    Ajouter une autre piste
                    <span className="text-xs bg-white/10 px-2 py-0.5 rounded text-gray-400">Tous formats supportés</span>
                </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;