export interface AudioFile {
  name: string;
  url: string;
  blob: Blob;
  buffer?: AudioBuffer;
}

export interface Track {
  id: string;
  name: string;
  blob: Blob;
  buffer: AudioBuffer;
  isMuted: boolean;
}

export enum AnalysisType {
  TRANSCRIPTION = 'Transcription',
  SUMMARY = 'Résumé',
  SENTIMENT = 'Sentiment',
  KEYWORDS = 'Mots-clés',
}

export interface AnalysisResult {
  trackName: string;
  type: AnalysisType;
  text: string;
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export type ChannelMode = 'left' | 'right' | 'stereo';

export type ExportFormat = 'wav' | 'webm' | 'mp4' | 'mp3';
