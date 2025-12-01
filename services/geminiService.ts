import { GoogleGenAI } from "@google/genai";
import { AnalysisType } from "../types";

const getGeminiClient = () => {
    if (!process.env.API_KEY) {
        throw new Error("API_KEY is missing from environment variables");
    }
    return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const analyzeAudio = async (
    audioBase64: string, 
    type: AnalysisType
): Promise<string> => {
    const ai = getGeminiClient();
    
    let prompt = "";
    switch (type) {
        case AnalysisType.TRANSCRIPTION:
            prompt = "Veuillez transcrire cet audio en texte avec précision. Ne donnez que la transcription.";
            break;
        case AnalysisType.SUMMARY:
            prompt = "Veuillez fournir un résumé concis mais détaillé de cet enregistrement audio.";
            break;
        case AnalysisType.SENTIMENT:
            prompt = "Analysez le sentiment et le ton émotionnel de cet audio. Soyez analytique.";
            break;
        case AnalysisType.KEYWORDS:
            prompt = "Extrayez les mots-clés principaux et les sujets abordés dans cet audio.";
            break;
        default:
            prompt = "Analysez cet audio.";
    }

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [
                    {
                        inlineData: {
                            mimeType: 'audio/wav',
                            data: audioBase64
                        }
                    },
                    { text: prompt }
                ]
            }
        });

        return response.text || "Aucun résultat généré.";
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw new Error("L'analyse a échoué. Vérifiez votre connexion ou votre clé API.");
    }
};