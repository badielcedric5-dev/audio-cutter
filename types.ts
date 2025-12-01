export interface AudioFile {
  name: string;
  url: string;
  blob: Blob;
  buffer?: AudioBuffer;
}

export enum AnalysisType {
  TRANSCRIPTION = 'Transcription',
  SUMMARY = 'Résumé',
  SENTIMENT = 'Sentiment',
  KEYWORDS = 'Mots-clés',
}

export interface AnalysisResult {
  type: AnalysisType;
  text: string;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}