import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Activity, Plus, Music } from 'lucide-react';
import WaveformEditor, { WaveformEditorRef } from './components/WaveformEditor';
import { decodeAudio, cutAudioRegion, extractAudioRegion, blobToBase64, concatenateAudioBuffers, insertAudioBuffer, pasteAudioToChannel, padAudioBuffer, bufferToWave, applyAudioEffects } from './utils/audioUtils';
import { analyzeAudio } from './services/geminiService';
import { AnalysisType, AnalysisResult, Track, ChannelMode } from './types';
import { X } from 'lucide-react';
import { Sparkles } from 'lucide-react';

const WORKSPACE_PADDING_SECONDS = 300; 

function App() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [selectedAnalysisType, setSelectedAnalysisType] = useState<AnalysisType>(AnalysisType.TRANSCRIPTION);
  
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
      alert("Impossible de charger le fichier audio.");
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

  const handleAnalyzeRegion = async (trackId: string, start: number, end: number, mode: ChannelMode) => {
    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    setFocusedTrackId(trackId);
    setIsProcessing(true);
    setAnalysisResult(null); 

    try {
        const ctx = getAudioContext();
        const regionBuffer = extractAudioRegion(track.buffer, start, end, mode, ctx);
        const regionBlob = bufferToWave(regionBuffer, regionBuffer.length);
        const base64 = await blobToBase64(regionBlob);
        
        const text = await analyzeAudio(base64, selectedAnalysisType);
        setAnalysisResult({ 
            trackName: track.name,
            type: selectedAnalysisType, 
            text 
        });
    } catch (error) {
        console.error("Analysis failed", error);
        setAnalysisResult({ 
            trackName: track.name,
            type: selectedAnalysisType, 
            text: "Erreur lors de l'analyse." 
        });
    } finally {
        setIsProcessing(false);
    }
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
                          // We treat this as an overwrite/mix-in similar to pasteAudioToChannel but across both channels
                          // For simplicity, we can use the manual overwrite logic we had, or adapt pasteAudioToChannel
                          // Let's stick to the robust logic we built:
                          
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

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-primary/30 pb-20">
      
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
            <button 
                onClick={() => addTrackInputRef.current?.click()}
                className="flex items-center gap-2 text-sm bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-full transition shadow-lg shadow-primary/20"
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
              Ajoutez votre première piste audio pour commencer l'édition.
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
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            
            <div className="lg:col-span-2 flex flex-col gap-4">
                {tracks.map((track) => (
                    <WaveformEditor 
                        key={track.id} // REMOVED track.blob.size to prevent full re-mount on edit
                        ref={(el) => {
                            if (el) trackRefs.current.set(track.id, el);
                            else trackRefs.current.delete(track.id);
                        }}
                        trackId={track.id}
                        trackName={track.name}
                        audioBlob={track.blob}
                        audioBuffer={track.buffer}
                        onUpdateBlob={() => {}}
                        onExtractRegion={(s, e, m) => handleAnalyzeRegion(track.id, s, e, m)}
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
                </button>
            </div>

            <div className="lg:col-span-1">
                <div className="bg-surface border border-secondary rounded-xl p-6 flex flex-col gap-6 h-fit sticky top-24">
                    <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="text-amber-400" size={20} />
                        <h2 className="text-lg font-semibold">Analyse Gemini</h2>
                    </div>

                    <div className="space-y-4">
                        <label className="block text-sm font-medium text-gray-400 mb-2">Type d'analyse</label>
                        <div className="grid grid-cols-2 gap-2">
                            {Object.values(AnalysisType).map((type) => (
                                <button
                                    key={type}
                                    onClick={() => setSelectedAnalysisType(type)}
                                    className={`px-3 py-2 rounded-lg text-sm text-left transition-all border ${
                                        selectedAnalysisType === type 
                                        ? 'bg-primary/20 border-primary text-white' 
                                        : 'bg-black/20 border-transparent hover:bg-black/40 text-gray-400'
                                    }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="min-h-[200px] bg-black/20 rounded-lg p-4 border border-secondary overflow-y-auto max-h-[calc(100vh-300px)]">
                        {analysisResult && (
                            <div className="animate-in fade-in zoom-in-95">
                                <div className="flex flex-col gap-1 mb-3 border-b border-white/10 pb-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-primary uppercase tracking-wider">
                                            {analysisResult.type}
                                        </span>
                                        <button onClick={() => setAnalysisResult(null)} className="text-gray-500 hover:text-white">
                                            <X size={14} />
                                        </button>
                                    </div>
                                    <span className="text-xs text-gray-500 italic">
                                        Source : {analysisResult.trackName}
                                    </span>
                                </div>
                                <p className="text-sm leading-relaxed whitespace-pre-line text-gray-200">
                                    {analysisResult.text}
                                </p>
                            </div>
                        )}
                        {!analysisResult && !isProcessing && (
                            <div className="text-gray-500 text-center py-8 text-sm">
                                Sélectionnez une zone et cliquez sur l'icône baguette magique.
                            </div>
                        )}
                         {isProcessing && !analysisResult && (
                            <div className="flex justify-center py-8">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}

export default App;