import React, { useState, useCallback, useRef } from 'react';
import { Upload, FileAudio, Scissors, Download, Sparkles, Activity, Trash2, X } from 'lucide-react';
import WaveformEditor from './components/WaveformEditor';
import { decodeAudio, cutAudioRegion, extractAudioRegion, blobToBase64 } from './utils/audioUtils';
import { analyzeAudio } from './services/geminiService';
import { AnalysisType, AnalysisResult } from './types';

function App() {
  const [audioFile, setAudioFile] = useState<{ blob: Blob, name: string } | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [selectedAnalysisType, setSelectedAnalysisType] = useState<AnalysisType>(AnalysisType.TRANSCRIPTION);
  
  // Audio Context is needed for decoding/encoding
  const audioContextRef = useRef<AudioContext | null>(null);

  const getAudioContext = () => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = getAudioContext();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      setAudioBuffer(decodedBuffer);
      setAudioFile({ blob: file, name: file.name });
      setAnalysisResult(null);
    } catch (error) {
      console.error("Error loading audio:", error);
      alert("Impossible de charger le fichier audio.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Called when Waveform component updates the blob (e.g. after a cut)
  const handleUpdateBlob = useCallback(async (newBlob: Blob) => {
      setIsProcessing(true);
      try {
        const ctx = getAudioContext();
        const decodedBuffer = await decodeAudio(newBlob, ctx);
        setAudioBuffer(decodedBuffer);
        setAudioFile(prev => prev ? { ...prev, blob: newBlob } : null);
      } catch (e) {
          console.error("Error updating blob", e);
      } finally {
          setIsProcessing(false);
      }
  }, []);

  // Handle cutting (deleting) the selected region
  const handleCutRegion = async (start: number, end: number) => {
    if (!audioBuffer) return;
    
    setIsProcessing(true);
    try {
        const ctx = getAudioContext();
        // Create new blob excluding the region
        const newBlob = cutAudioRegion(audioBuffer, start, end, ctx);
        await handleUpdateBlob(newBlob);
    } catch (error) {
        console.error("Cut failed", error);
    } finally {
        setIsProcessing(false);
    }
  };

  // Handle analyzing the selected region with Gemini
  const handleAnalyzeRegion = async (start: number, end: number) => {
    if (!audioBuffer) return;

    setIsProcessing(true);
    setAnalysisResult(null); // Clear previous

    try {
        const ctx = getAudioContext();
        const regionBlob = extractAudioRegion(audioBuffer, start, end, ctx);
        const base64 = await blobToBase64(regionBlob);
        
        const text = await analyzeAudio(base64, selectedAnalysisType);
        setAnalysisResult({ type: selectedAnalysisType, text });
    } catch (error) {
        console.error("Analysis failed", error);
        setAnalysisResult({ type: selectedAnalysisType, text: "Erreur lors de l'analyse." });
    } finally {
        setIsProcessing(false);
    }
  };

  const handleDownload = () => {
      if (!audioFile) return;
      const url = URL.createObjectURL(audioFile.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `edited_${audioFile.name}`;
      a.click();
      URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans selection:bg-primary/30">
      
      {/* Header */}
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
          {audioFile && (
             <button 
                onClick={handleDownload}
                className="flex items-center gap-2 text-sm bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-full transition"
             >
                <Download size={16} />
                Exporter WAV
             </button>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-6 flex flex-col gap-8">
        
        {/* Upload Section (if no file) */}
        {!audioFile && (
          <div className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-secondary rounded-3xl bg-surface/30 p-12 transition-all hover:border-primary/50 group">
            <div className="bg-surface p-6 rounded-full mb-6 group-hover:scale-110 transition-transform duration-300 shadow-2xl">
                <FileAudio size={48} className="text-primary" />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-center">Glissez votre fichier audio ici</h2>
            <p className="text-gray-400 mb-8 text-center max-w-md">
              Supporte WAV, MP3, FLAC. Éditez, découpez et analysez votre audio grâce à l'intelligence artificielle Gemini.
            </p>
            <label className="relative cursor-pointer">
              <input 
                type="file" 
                accept="audio/*" 
                onChange={handleFileUpload} 
                className="hidden" 
              />
              <span className="bg-primary hover:bg-primary/90 text-white px-8 py-3 rounded-full font-medium shadow-lg hover:shadow-primary/25 transition-all flex items-center gap-2">
                <Upload size={18} />
                Importer un fichier
              </span>
            </label>
          </div>
        )}

        {/* Editor Section */}
        {audioFile && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            
            {/* Left: Editor */}
            <div className="lg:col-span-2 space-y-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <Scissors className="text-primary" size={20} />
                        Éditeur
                    </h2>
                    <span className="text-sm text-gray-500 font-mono">{audioFile.name}</span>
                </div>

                {/* Using a key ensures WaveformEditor remounts if blob changes drastically, though internal useEffect handles it too */}
                <WaveformEditor 
                    key={audioFile.name + audioFile.blob.size}
                    audioBlob={audioFile.blob}
                    onUpdateBlob={handleUpdateBlob}
                    onExtractRegion={handleAnalyzeRegion}
                    onCutRegion={handleCutRegion}
                    isProcessing={isProcessing}
                />

                {/* Instructions */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-400">
                    <div className="bg-surface p-4 rounded-lg border border-secondary/50">
                        <strong className="text-white block mb-1">Pour couper :</strong>
                        Selectionnez une zone sur l'onde, puis cliquez sur le bouton "Couper" pour supprimer la partie sélectionnée.
                    </div>
                    <div className="bg-surface p-4 rounded-lg border border-secondary/50">
                        <strong className="text-white block mb-1">Pour analyser :</strong>
                        Créez une région, sélectionnez le type d'analyse (résumé, transcription) et cliquez sur "Analyser".
                    </div>
                </div>
            </div>

            {/* Right: AI Tools */}
            <div className="bg-surface border border-secondary rounded-xl p-6 flex flex-col gap-6 h-fit sticky top-24">
                <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="text-amber-400" size={20} />
                    <h2 className="text-lg font-semibold">Intelligence Gemini</h2>
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

                <div className="min-h-[200px] bg-black/20 rounded-lg p-4 border border-secondary overflow-y-auto max-h-[400px]">
                    {!analysisResult && !isProcessing && (
                        <div className="h-full flex flex-col items-center justify-center text-gray-500 text-center gap-2 opacity-50">
                            <Sparkles size={32} />
                            <p className="text-sm">Sélectionnez une zone sur l'audio pour voir l'analyse ici.</p>
                        </div>
                    )}

                    {isProcessing && !analysisResult && (
                        <div className="flex flex-col items-center justify-center h-full gap-3">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                            <span className="text-sm animate-pulse">Gemini réfléchit...</span>
                        </div>
                    )}

                    {analysisResult && (
                        <div className="animate-in fade-in zoom-in-95">
                             <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                                <span className="text-xs font-bold text-primary uppercase tracking-wider">
                                    {analysisResult.type}
                                </span>
                                <button onClick={() => setAnalysisResult(null)} className="text-gray-500 hover:text-white">
                                    <X size={14} />
                                </button>
                             </div>
                             <p className="text-sm leading-relaxed whitespace-pre-line text-gray-200">
                                {analysisResult.text}
                             </p>
                        </div>
                    )}
                </div>

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-xs text-blue-200">
                    <p>
                        <strong>Note :</strong> L'analyse utilise le modèle <code>gemini-2.5-flash</code> pour traiter l'audio directement. Assurez-vous d'avoir une clé API valide.
                    </p>
                </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
}

export default App;