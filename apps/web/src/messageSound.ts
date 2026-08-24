const MESSAGE_SOUND_PATH = "/sounds/message.mp3";
const MESSAGE_SOUND_VOLUME = 0.8;

type MessageAudio = Pick<HTMLAudioElement, "play" | "volume">;

export function playMessageSoundIfPageUnfocused(
  page: Pick<Document, "hasFocus"> = document,
  createAudio: (source: string) => MessageAudio = (source) => new Audio(source),
): boolean {
  if (page.hasFocus()) return false;

  const audio = createAudio(MESSAGE_SOUND_PATH);
  audio.volume = MESSAGE_SOUND_VOLUME;
  try {
    void audio.play().catch(() => undefined);
  } catch {
    // Browsers may reject playback when media autoplay is unavailable.
  }
  return true;
}
