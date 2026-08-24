import { describe, expect, it, vi } from "vitest";

import { playMessageSoundIfPageUnfocused } from "./messageSound";

describe("message completion sound", () => {
  it("plays the SillyTavern message sound at 80% volume when unfocused", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const audio = { play, volume: 1 };
    const createAudio = vi.fn(() => audio);

    expect(
      playMessageSoundIfPageUnfocused({ hasFocus: () => false }, createAudio),
    ).toBe(true);
    expect(createAudio).toHaveBeenCalledWith("/sounds/message.mp3");
    expect(audio.volume).toBe(0.8);
    expect(play).toHaveBeenCalledOnce();
  });

  it("stays silent while the page has focus", () => {
    const createAudio = vi.fn();

    expect(
      playMessageSoundIfPageUnfocused({ hasFocus: () => true }, createAudio),
    ).toBe(false);
    expect(createAudio).not.toHaveBeenCalled();
  });

  it("does not surface browser playback rejection", async () => {
    const play = vi.fn().mockRejectedValue(new Error("autoplay blocked"));

    expect(() =>
      playMessageSoundIfPageUnfocused({ hasFocus: () => false }, () => ({
        play,
        volume: 1,
      })),
    ).not.toThrow();
    await Promise.resolve();
  });
});
