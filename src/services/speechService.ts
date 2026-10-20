export type SpeechAccent = 'en-GB' | 'en-US' | 'other';

export interface SpeechVoiceOption {
  name: string;
  lang: string;
  voiceURI: string;
  accent: SpeechAccent;
}

export const ACCENT_LABELS: Record<SpeechAccent, string> = {
  'en-GB': '英式英语',
  'en-US': '美式英语',
  other: '其他英语',
};

/** 所有发音均为浏览器合成语音（TTS），并非真人录音文件。 */
export const SPEECH_SOURCE_LABEL = '浏览器合成语音';

const isEnglishVoice = (voice: SpeechSynthesisVoice): boolean => /^en([-_]|$)/i.test(voice.lang);

export const getAccent = (lang: string): SpeechAccent => {
  const normalized = lang.replace('_', '-').toLowerCase();
  if (normalized === 'en-gb') return 'en-GB';
  if (normalized === 'en-us') return 'en-US';
  return 'other';
};

export const speechService = {
  isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  },

  getVoiceOptions(): SpeechVoiceOption[] {
    if (!this.isSupported()) return [];
    const order: SpeechAccent[] = ['en-GB', 'en-US', 'other'];
    return window.speechSynthesis
      .getVoices()
      .filter(isEnglishVoice)
      .map((voice) => ({ name: voice.name, lang: voice.lang, voiceURI: voice.voiceURI, accent: getAccent(voice.lang) }))
      .sort((a, b) => order.indexOf(a.accent) - order.indexOf(b.accent) || a.name.localeCompare(b.name));
  },

  /** 监听语音列表变化（部分浏览器异步加载语音），返回取消监听函数 */
  onVoicesChanged(callback: () => void): () => void {
    if (!this.isSupported()) return () => undefined;
    const synth = window.speechSynthesis;
    synth.addEventListener?.('voiceschanged', callback);
    return () => synth.removeEventListener?.('voiceschanged', callback);
  },

  async speak(text: string, voiceURI: string, rate: number): Promise<void> {
    if (!this.isSupported()) {
      throw new Error('当前浏览器不支持语音合成，请参考音标和谐音学习。');
    }
    const content = text.trim();
    if (!content) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(content);
    utterance.rate = Math.max(0.5, Math.min(1.2, rate));
    const voices = synth.getVoices();
    const preferred = voices.find((voice) => voice.voiceURI === voiceURI) ?? voices.find(isEnglishVoice);
    if (preferred) {
      utterance.voice = preferred;
      utterance.lang = preferred.lang;
    } else if (voices.length > 0) {
      throw new Error('当前设备没有可用的英语语音，请在系统中安装英语语音包。');
    } else {
      // 语音列表尚未加载时交给浏览器使用默认英语语音
      utterance.lang = 'en-US';
    }
    await new Promise<void>((resolve, reject) => {
      utterance.onend = () => resolve();
      utterance.onerror = (event) => {
        const reason = (event as SpeechSynthesisErrorEvent).error;
        if (reason === 'canceled' || reason === 'interrupted') resolve();
        else reject(new Error(`语音播放失败${reason ? `（${reason}）` : ''}。`));
      };
      synth.speak(utterance);
    });
  },

  stop(): void {
    if (this.isSupported()) {
      window.speechSynthesis.cancel();
    }
  },
};
