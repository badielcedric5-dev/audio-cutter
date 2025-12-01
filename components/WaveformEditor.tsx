import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import ZoomPlugin from 'wavesurfer.js/dist/plugins/zoom.esm.js';
import { Play, Pause, ZoomIn, ZoomOut, Wand2, Trash2, PlusCircle, XCircle, Volume2, Headphones, Check, Layers, Mic, Square } from 'lucide-react';
import { ChannelMode } from '../types';

export interface WaveformEditorRef {
    togglePlay: () => void;
    deleteSelectedRegion: () => void;
    getSelectedRegion: () => { start: number, end: number, channelMode: ChannelMode } | null;
    getCurrentTime: () => number;
    getChannelMode: () => ChannelMode;
    isPlaying: boolean;
}

interface WaveformEditorProps {
    trackId: string;
    trackName: string;
    audioBlob: Blob; // Used for playback source
    audioBuffer: AudioBuffer; // Used for immediate visual rendering
    onUpdateBlob: (newBlob: Blob) => void;
    onExtractRegion: (start: number, end: number, channelMode: ChannelMode) => void;
    onCutRegion?: (start: number, end: number, channelMode: ChannelMode) => void;
    onAppendAudio?: () => void;
    onRemoveTrack?: () => void;
    onApplyEffects?: (start: number, end: number, volume: number, pan: number) => void;
    onRecordToggle?: (start: number, end: number | null, mode: ChannelMode) => void;
    isProcessing: boolean;
    isFocused: boolean;
    onFocus: () => void;
    isRecording: boolean;
}

const WaveformEditor = forwardRef<WaveformEditorRef, WaveformEditorProps>(({ 
    trackId,
    trackName,
    audioBlob, 
    audioBuffer,
    onExtractRegion,
    onCutRegion,
    onAppendAudio,
    onRemoveTrack,
    onApplyEffects,
    onRecordToggle,
    isProcessing,
    isFocused,
    onFocus,
    isRecording
}, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const regionsRef = useRef<RegionsPlugin | null>(null);
    const justClickedRegion = useRef(false);
    
    // We use a ref to track activeRegion synchronously for the restore logic
    const activeRegionRef = useRef<{start: number, end: number, id: string} | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [zoom, setZoom] = useState(10);
    const [activeRegion, setActiveRegion] = useState<{start: number, end: number, id: string} | null>(null);
    const [channelMode, setChannelMode] = useState<ChannelMode>('stereo');

    // Audio Effect States
    const [volume, setVolume] = useState(1);
    const [pan, setPan] = useState(0);

    // Sync ref with state
    useEffect(() => {
        activeRegionRef.current = activeRegion;
    }, [activeRegion]);

    const handlePlayPause = () => {
        onFocus();
        if (!wavesurferRef.current || !isReady) return;

        if (wavesurferRef.current.isPlaying()) {
            wavesurferRef.current.pause();
        } else {
            if (activeRegion) {
                wavesurferRef.current.play(activeRegion.start, activeRegion.end);
            } else {
                wavesurferRef.current.play();
            }
        }
    };

    useImperativeHandle(ref, () => ({
        togglePlay: handlePlayPause,
        deleteSelectedRegion: () => {
            handleDeleteRegion();
        },
        getSelectedRegion: () => {
            if (activeRegion) {
                return { start: activeRegion.start, end: activeRegion.end, channelMode };
            }
            return null;
        },
        getCurrentTime: () => {
            return wavesurferRef.current?.getCurrentTime() || 0;
        },
        getChannelMode: () => channelMode,
        isPlaying
    }), [activeRegion, channelMode, isPlaying, isReady]);

    // 1. Initialize Wavesurfer ONCE
    useEffect(() => {
        if (!containerRef.current) return;
        if (wavesurferRef.current) return; // Prevent double init

        const ws = WaveSurfer.create({
            container: containerRef.current,
            waveColor: '#8b5cf6',
            progressColor: '#c4b5fd',
            cursorColor: '#f4f4f5',
            barWidth: 2,
            barGap: 3,
            height: 140,
            autoScroll: true,
            minPxPerSec: zoom,
            normalize: true,
            splitChannels: true,
        });

        const wsRegions = ws.registerPlugin(RegionsPlugin.create());
        ws.registerPlugin(TimelinePlugin.create());
        ws.registerPlugin(ZoomPlugin.create());

        regionsRef.current = wsRegions;
        wavesurferRef.current = ws;

        ws.on('ready', () => {
            setIsReady(true);
            ws.zoom(zoom);
        });

        ws.on('timeupdate', (time) => setCurrentTime(time));
        ws.on('play', () => setIsPlaying(true));
        ws.on('pause', () => setIsPlaying(false));
        ws.on('finish', () => setIsPlaying(false));
        ws.on('interaction', () => onFocus());

        ws.on('click', () => {
            if (justClickedRegion.current) {
                justClickedRegion.current = false;
                return;
            }
            wsRegions.clearRegions();
            setActiveRegion(null);
            setVolume(1);
            setPan(0);
        });

        wsRegions.on('region-created', (region) => {
             onFocus();
             // Remove other regions to ensure only one is active
             wsRegions.getRegions().forEach(r => {
                 if (r.id !== region.id) r.remove();
             });
             setActiveRegion({ start: region.start, end: region.end, id: region.id });
        });

        wsRegions.on('region-updated', (region) => {
            onFocus();
            setActiveRegion({ start: region.start, end: region.end, id: region.id });
        });
        
        wsRegions.on('region-clicked', (region, e) => {
            e.stopPropagation();
            justClickedRegion.current = true;
            onFocus();
            setActiveRegion({ start: region.start, end: region.end, id: region.id });
            setTimeout(() => { justClickedRegion.current = false; }, 100);
        });

        wsRegions.on('region-removed', (region) => {
            // Only clear active region if it matches the removed one
            // Use the ref inside this callback to ensure we check against latest state logic if needed,
            // but setState updater is safer.
            setActiveRegion(prev => (prev?.id === region.id ? null : prev));
        });

        wsRegions.enableDragSelection({ color: 'rgba(139, 92, 246, 0.3)' });

        return () => {
            ws.destroy();
            wavesurferRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Run once on mount

    // 2. Handle Audio Buffer Updates (The "Instant Update" logic)
    useEffect(() => {
        if (!wavesurferRef.current || !audioBuffer) return;

        const ws = wavesurferRef.current;
        const url = URL.createObjectURL(audioBlob);

        // Capture current active region (from ref) BEFORE it gets wiped by ws.load
        const savedRegion = activeRegionRef.current;

        // Prepare raw channel data
        const channelData = [];
        for(let i=0; i < audioBuffer.numberOfChannels; i++) {
            channelData.push(audioBuffer.getChannelData(i));
        }
        
        // Preserve current time
        const prevTime = ws.getCurrentTime();
        
        // Load new data (this clears regions internally in wavesurfer)
        ws.load(url, channelData);

        // We do NOT explicitly set ActiveRegion to null here.
        // The 'region-removed' event listener will fire as wavesurfer clears regions.
        // However, we have `savedRegion` in this closure to restore it.

        // Restore position and region after load
        ws.once('ready', () => {
            if (prevTime > 0 && prevTime < audioBuffer.duration) {
                ws.setTime(prevTime);
            }
            
            // Restore Selection if it existed
            if (savedRegion && regionsRef.current) {
                // Add region back. This triggers 'region-created', which sets state.
                regionsRef.current.addRegion({
                    start: savedRegion.start,
                    end: savedRegion.end,
                    id: savedRegion.id,
                    color: getRegionColor(channelMode)
                });
            }
        });

        return () => {
            URL.revokeObjectURL(url);
        };
    }, [audioBuffer, audioBlob]); // Re-run when buffer changes

    useEffect(() => {
        if (wavesurferRef.current && isReady) {
            wavesurferRef.current.zoom(zoom);
        }
    }, [zoom, isReady]);

    // Update Region Color based on Channel Mode
    useEffect(() => {
        if (activeRegion && regionsRef.current) {
            const region = regionsRef.current.getRegions().find(r => r.id === activeRegion.id);
            if (region) {
                region.setOptions({ color: getRegionColor(channelMode) });
            }
        }
    }, [channelMode, activeRegion]);

    const getRegionColor = (mode: ChannelMode) => {
        if (mode === 'left') return 'rgba(239, 68, 68, 0.3)';
        if (mode === 'right') return 'rgba(6, 182, 212, 0.3)';
        return 'rgba(139, 92, 246, 0.3)'; // stereo
    };

    const handleDeleteRegion = () => {
        if (activeRegion && onCutRegion) {
            onCutRegion(activeRegion.start, activeRegion.end, channelMode);
            // We don't manually clear regions here; let the buffer update loop handle the restoration if logic dictates,
            // but for a CUT, usually we want the selection to disappear or adjust. 
            // Standard behavior: Cut removes the audio, so the selection becomes invalid or 0-length.
            // So we explicitly clear activeRegionRef here to prevent restoration of a deleted zone.
            activeRegionRef.current = null; 
            regionsRef.current?.clearRegions();
            setActiveRegion(null);
        }
    };

    const handleApplyEffects = () => {
        if (activeRegion && onApplyEffects) {
            onApplyEffects(activeRegion.start, activeRegion.end, volume, pan);
        }
    };

    const handleRecordClick = () => {
        if (!onRecordToggle) return;
        if (isRecording) {
            onRecordToggle(0, 0, channelMode);
        } else {
            if (activeRegion) {
                onRecordToggle(activeRegion.start, activeRegion.end, channelMode);
            } else {
                const currentTime = wavesurferRef.current?.getCurrentTime() || 0;
                onRecordToggle(currentTime, null, channelMode);
            }
        }
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div 
            onClick={onFocus}
            className={`flex flex-col gap-3 bg-surface p-4 rounded-xl shadow-lg transition-all duration-200 ${
                isFocused 
                ? 'border-2 border-primary/50 ring-1 ring-primary/20' 
                : 'border border-secondary hover:border-secondary/80'
            }`}
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded transition-colors ${isFocused ? 'bg-primary text-white' : 'bg-primary/20 text-primary'}`}>
                        <Play size={14} />
                    </div>
                    <span className="font-medium text-sm text-gray-200 truncate max-w-[200px]" title={trackName}>{trackName}</span>
                    {isFocused && <span className="text-[10px] bg-primary/20 text-primary px-1.5 rounded ml-2">ACTIF</span>}
                    {isRecording && <span className="text-[10px] bg-red-500/20 text-red-500 px-1.5 rounded ml-2 animate-pulse">ENREGISTREMENT</span>}
                </div>
                {onRemoveTrack && (
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            onRemoveTrack();
                        }}
                        className="text-gray-400 hover:text-red-400 hover:bg-red-500/10 p-1.5 rounded transition-colors"
                        title="Supprimer la piste"
                    >
                        <XCircle size={20} />
                    </button>
                )}
            </div>

            {/* Waveform */}
            <div className="relative group min-h-[140px] bg-black/40 rounded-lg overflow-hidden border border-white/5">
                <div className="absolute left-1 top-2 text-[10px] text-red-400 font-bold z-10 pointer-events-none opacity-50">L</div>
                <div className="absolute left-1 bottom-2 text-[10px] text-cyan-400 font-bold z-10 pointer-events-none opacity-50">R</div>

                <div id={`waveform-${trackId}`} ref={containerRef} className="w-full" />
                {(!isReady || isProcessing) && (
                    <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-2">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                        </div>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                    <button 
                        onClick={(e) => { e.stopPropagation(); handlePlayPause(); }}
                        disabled={!isReady}
                        className="p-2 rounded-full bg-primary hover:bg-violet-600 disabled:opacity-50 text-white transition-all shadow"
                    >
                        {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                    </button>
                    <span className="text-xs text-gray-400 font-mono ml-1 w-12">
                        {formatTime(currentTime)}
                    </span>
                    
                    <div className="flex items-center gap-1 bg-black/20 p-0.5 rounded-lg ml-2">
                        <button 
                            onClick={(e) => { e.stopPropagation(); setZoom(z => Math.max(1, z - 10)); }}
                            disabled={!isReady}
                            className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-white transition"
                        >
                            <ZoomOut size={14} />
                        </button>
                        <button 
                            onClick={(e) => { e.stopPropagation(); setZoom(z => Math.min(200, z + 10)); }}
                            disabled={!isReady}
                            className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-white transition"
                        >
                            <ZoomIn size={14} />
                        </button>
                    </div>

                    <div className="flex items-center bg-black/40 rounded p-0.5 ml-2">
                        <button
                            onClick={(e) => { e.stopPropagation(); setChannelMode('left'); }}
                            className={`px-2 py-1 text-[10px] font-bold rounded ${channelMode === 'left' ? 'bg-red-500 text-white' : 'text-gray-400 hover:text-white'}`}
                            title="Canal Gauche (Haut)"
                        >
                            L
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setChannelMode('stereo'); }}
                            className={`px-2 py-1 text-[10px] font-bold rounded ${channelMode === 'stereo' ? 'bg-violet-500 text-white' : 'text-gray-400 hover:text-white'}`}
                            title="Stéréo (L+R)"
                        >
                            L+R
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); setChannelMode('right'); }}
                            className={`px-2 py-1 text-[10px] font-bold rounded ${channelMode === 'right' ? 'bg-cyan-500 text-white' : 'text-gray-400 hover:text-white'}`}
                            title="Canal Droit (Bas)"
                        >
                            R
                        </button>
                    </div>

                    <button
                        onClick={(e) => { e.stopPropagation(); handleRecordClick(); }}
                        className={`ml-2 p-1.5 rounded-full transition-all ${
                            isRecording 
                            ? 'bg-red-500 text-white animate-pulse' 
                            : 'bg-secondary/50 text-red-400 hover:bg-red-500 hover:text-white'
                        }`}
                        title={isRecording ? "Arrêter l'enregistrement" : "Enregistrer ici"}
                    >
                        {isRecording ? <Square size={14} fill="currentColor" /> : <Mic size={14} />}
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <button 
                        onClick={(e) => { e.stopPropagation(); onAppendAudio?.(); }}
                        disabled={isProcessing}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-secondary hover:bg-white/10 text-white transition-all border border-transparent hover:border-white/10"
                    >
                        <PlusCircle size={14} />
                        <span className="hidden sm:inline">Suite</span>
                    </button>
                    
                    {activeRegion ? (
                        <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2 bg-primary/10 border border-primary/20 px-2 py-1 rounded-lg">
                            <button
                                onClick={(e) => { e.stopPropagation(); handleRecordClick(); }}
                                className={`p-1.5 rounded transition-all ${
                                    isRecording 
                                    ? 'bg-red-500 text-white' 
                                    : 'hover:bg-red-500/20 text-red-400'
                                }`}
                                title="Enregistrer sur la sélection"
                            >
                                {isRecording ? <Square size={14} fill="currentColor" /> : <Mic size={14} />}
                            </button>

                            <div className="w-[1px] h-6 bg-white/10 mx-1"></div>

                            <div className="flex flex-col w-16 px-1">
                                <div className="flex justify-between items-center text-[10px] text-gray-400">
                                    <Volume2 size={10} />
                                    <span>{Math.round(volume * 100)}%</span>
                                </div>
                                <input 
                                    type="range" 
                                    min="0" max="2" step="0.1" 
                                    value={volume}
                                    onChange={(e) => setVolume(parseFloat(e.target.value))}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-primary"
                                />
                            </div>
                            <div className="flex flex-col w-16 px-1">
                                <div className="flex justify-between items-center text-[10px] text-gray-400">
                                    <Headphones size={10} />
                                    <span>Pan</span>
                                </div>
                                <input 
                                    type="range" 
                                    min="-1" max="1" step="0.1" 
                                    value={pan}
                                    onChange={(e) => setPan(parseFloat(e.target.value))}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                                />
                            </div>

                            <button
                                onClick={(e) => { e.stopPropagation(); handleApplyEffects(); }}
                                className="p-1.5 bg-green-500/20 text-green-400 hover:bg-green-500 hover:text-white rounded transition-colors"
                            >
                                <Check size={14} />
                            </button>

                            <div className="w-[1px] h-6 bg-white/10 mx-1"></div>

                            <button 
                                onClick={(e) => { e.stopPropagation(); handleDeleteRegion(); }}
                                className="p-1.5 hover:bg-red-500/20 text-red-400 rounded transition-colors"
                                title="Couper / Supprimer"
                            >
                                <Trash2 size={14} />
                            </button>
                            <button 
                                onClick={(e) => { e.stopPropagation(); if(activeRegion) onExtractRegion(activeRegion.start, activeRegion.end, channelMode); }}
                                className="p-1.5 hover:bg-blue-500/20 text-blue-400 rounded transition-colors"
                                title="Analyser"
                            >
                                <Wand2 size={14} />
                            </button>
                        </div>
                    ) : (
                         <div className="w-2"></div>
                    )}
                </div>
            </div>
        </div>
    );
});

export default WaveformEditor;