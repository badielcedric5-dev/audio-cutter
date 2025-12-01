import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';
import ZoomPlugin from 'wavesurfer.js/dist/plugins/zoom.esm.js';
import { Play, Pause, Scissors, ZoomIn, ZoomOut, Wand2, Trash2 } from 'lucide-react';

interface WaveformEditorProps {
    audioBlob: Blob;
    onUpdateBlob: (newBlob: Blob) => void;
    onExtractRegion: (start: number, end: number) => void;
    onCutRegion?: (start: number, end: number) => void;
    isProcessing: boolean;
}

const WaveformEditor: React.FC<WaveformEditorProps> = ({ 
    audioBlob, 
    onExtractRegion,
    onCutRegion,
    isProcessing 
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const wavesurferRef = useRef<WaveSurfer | null>(null);
    const regionsRef = useRef<RegionsPlugin | null>(null);
    
    const [isPlaying, setIsPlaying] = useState(false);
    const [isReady, setIsReady] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [zoom, setZoom] = useState(10);
    const [activeRegion, setActiveRegion] = useState<{start: number, end: number, id: string} | null>(null);

    // Initialize Wavesurfer
    useEffect(() => {
        if (!containerRef.current) return;

        // Reset state
        setIsReady(false);
        setCurrentTime(0);
        setIsPlaying(false);
        setActiveRegion(null);

        const ws = WaveSurfer.create({
            container: containerRef.current,
            waveColor: '#8b5cf6', // Violet-500
            progressColor: '#c4b5fd', // Violet-200
            cursorColor: '#f4f4f5',
            barWidth: 2,
            barGap: 3,
            height: 128,
            autoScroll: true,
            minPxPerSec: zoom,
        });

        // Register plugins
        const wsRegions = ws.registerPlugin(RegionsPlugin.create());
        ws.registerPlugin(TimelinePlugin.create());
        ws.registerPlugin(ZoomPlugin.create());

        regionsRef.current = wsRegions;
        wavesurferRef.current = ws;

        // Event listeners
        ws.on('ready', () => {
            setIsReady(true);
            ws.zoom(zoom); // Apply zoom once ready
        });

        ws.on('timeupdate', (time) => {
            setCurrentTime(time);
        });

        ws.on('play', () => setIsPlaying(true));
        ws.on('pause', () => setIsPlaying(false));
        ws.on('finish', () => setIsPlaying(false));
        
        wsRegions.on('region-created', (region) => {
             // Ensure only one region is active
             wsRegions.getRegions().forEach(r => {
                 if (r.id !== region.id) r.remove();
             });
             setActiveRegion({ start: region.start, end: region.end, id: region.id });
        });

        wsRegions.on('region-updated', (region) => {
            setActiveRegion({ start: region.start, end: region.end, id: region.id });
        });
        
        wsRegions.on('region-removed', () => {
            setActiveRegion(null);
        });

        wsRegions.enableDragSelection({
            color: 'rgba(139, 92, 246, 0.3)',
        });

        // Load audio safely
        const audioUrl = URL.createObjectURL(audioBlob);
        ws.load(audioUrl).catch((err) => {
            // Ignore AbortError which happens when component unmounts quickly during loading
            if (err.name === 'AbortError' || err.message?.includes('aborted')) return;
            console.error("WaveSurfer load error:", err);
        });

        return () => {
            // Destroying while loading triggers an AbortError on the fetch, which we catch above
            ws.destroy();
            URL.revokeObjectURL(audioUrl);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audioBlob]);

    // Update Zoom
    useEffect(() => {
        if (wavesurferRef.current && isReady) {
            wavesurferRef.current.zoom(zoom);
        }
    }, [zoom, isReady]);

    const togglePlay = () => {
        if (wavesurferRef.current && isReady) {
            wavesurferRef.current.playPause();
        }
    };

    const handleDeleteRegion = () => {
        if (activeRegion && onCutRegion) {
            onCutRegion(activeRegion.start, activeRegion.end);
            regionsRef.current?.clearRegions();
            setActiveRegion(null);
        }
    };

    // UI Helpers
    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <div className="flex flex-col gap-4 bg-surface p-6 rounded-xl border border-secondary shadow-xl">
            {/* Waveform Container */}
            <div className="relative group min-h-[128px]">
                <div id="waveform" ref={containerRef} className="w-full" />
                {(!isReady || isProcessing) && (
                    <div className="absolute inset-0 bg-background/80 flex items-center justify-center z-10 backdrop-blur-sm rounded">
                        <div className="flex flex-col items-center gap-2">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            <span className="text-sm font-medium text-gray-300">
                                {isProcessing ? "Traitement..." : "Chargement..."}
                            </span>
                        </div>
                    </div>
                )}
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-secondary pt-4">
                
                <div className="flex items-center gap-2">
                    <button 
                        onClick={togglePlay}
                        disabled={!isReady}
                        className="p-3 rounded-full bg-primary hover:bg-violet-600 disabled:opacity-50 text-white transition-all shadow-lg hover:shadow-primary/20"
                    >
                        {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                    </button>
                    <span className="text-xs text-gray-400 font-mono ml-2">
                        {formatTime(currentTime)}
                    </span>
                </div>

                <div className="flex items-center gap-2 bg-black/20 p-1 rounded-lg">
                    <button 
                        onClick={() => setZoom(z => Math.max(1, z - 10))}
                        disabled={!isReady}
                        className="p-2 hover:bg-white/10 rounded-md text-gray-400 hover:text-white transition disabled:opacity-50"
                    >
                        <ZoomOut size={18} />
                    </button>
                    <span className="text-xs text-gray-500 w-12 text-center">Zoom</span>
                    <button 
                        onClick={() => setZoom(z => Math.min(200, z + 10))}
                        disabled={!isReady}
                        className="p-2 hover:bg-white/10 rounded-md text-gray-400 hover:text-white transition disabled:opacity-50"
                    >
                        <ZoomIn size={18} />
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    {/* Cut Button */}
                    <button 
                        disabled={!activeRegion || isProcessing || !onCutRegion}
                        onClick={handleDeleteRegion}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                            !activeRegion 
                                ? 'bg-secondary/50 text-gray-500 cursor-not-allowed' 
                                : 'bg-red-500/10 text-red-400 border border-red-500/50 hover:bg-red-500/20'
                        }`}
                        title="Supprimer la sélection"
                    >
                        <Trash2 size={18} />
                        <span className="hidden sm:inline">Couper</span>
                    </button>

                    {/* Analysis Button */}
                    <button 
                        disabled={!activeRegion || isProcessing}
                        onClick={() => activeRegion && onExtractRegion(activeRegion.start, activeRegion.end)}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                            !activeRegion 
                                ? 'bg-secondary/50 text-gray-500 cursor-not-allowed' 
                                : 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white hover:brightness-110 shadow-lg shadow-cyan-900/20'
                        }`}
                        title="Analyser la sélection avec Gemini"
                    >
                        <Wand2 size={18} />
                        <span className="hidden sm:inline">Analyser</span>
                    </button>
                </div>
            </div>
            
             {/* Region Actions Helper */}
             {activeRegion && (
                <div className="flex items-center justify-between bg-yellow-500/10 border border-yellow-500/20 p-3 rounded-lg text-sm text-yellow-200 animate-in fade-in slide-in-from-top-2">
                    <div className="flex gap-2 items-center">
                        <Scissors size={16} />
                        <span>Sélection : {formatTime(activeRegion.start)} - {formatTime(activeRegion.end)}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WaveformEditor;