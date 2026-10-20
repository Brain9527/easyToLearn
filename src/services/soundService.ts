let audioContext: AudioContext | null = null;

const getContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  const Context = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  if (!audioContext) {
    audioContext = new Context();
  }
  return audioContext;
};

/** 使用 Web Audio 在本地生成的简短“叮”声，不依赖任何外部资源。 */
export const soundService = {
  async playSuccess(): Promise<void> {
    try {
      const context = getContext();
      if (!context) return;
      // 浏览器自动播放策略：AudioContext 可能处于 suspended，需在用户操作后恢复
      if (context.state === 'suspended') await context.resume();
      const start = context.currentTime;
      const gainNode = context.createGain();
      gainNode.gain.setValueAtTime(0.0001, start);
      gainNode.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
      gainNode.connect(context.destination);
      [523.25, 783.99].forEach((frequency, index) => {
        const oscillator = context.createOscillator();
        oscillator.type = 'triangle';
        oscillator.frequency.setValueAtTime(frequency, start + index * 0.09);
        oscillator.connect(gainNode);
        oscillator.start(start + index * 0.09);
        oscillator.stop(start + 0.34);
      });
    } catch {
      // 音效属于辅助反馈，失败时静默降级，不影响答题流程
    }
  },
};
