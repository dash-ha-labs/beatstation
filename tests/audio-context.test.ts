import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => {
  const context = { state: 'suspended', lookAhead: 0 };
  const transport = {
    state: 'stopped', bpm: { value: 120 }, loop: false, position: 0,
    cancel: vi.fn(),
    start: vi.fn(() => { transport.state = 'started'; }),
    stop: vi.fn(() => { transport.state = 'stopped'; }),
  };
  const engine = {
    sync: vi.fn(), setSampleBuffer: vi.fn(), stopAudio: vi.fn(),
    preview: vi.fn(), dispose: vi.fn(),
  };
  return { context, transport, engine, start: vi.fn(), createEngine: vi.fn(() => engine) };
});

vi.mock('tone', () => ({
  start: audio.start,
  getContext: () => audio.context,
  getTransport: () => audio.transport,
}));
vi.mock('../src/audio/engine', () => ({ createEngine: audio.createEngine }));
vi.mock('../src/audio/buffers', () => ({
  getBuffer: vi.fn(), loadBuffer: vi.fn(), subscribeBuffers: vi.fn(),
}));
vi.mock('../src/audio/scheduler', () => ({
  bindScheduler: vi.fn(() => vi.fn()), gridStepAt: vi.fn(), stepSeconds: vi.fn(),
}));

import { disposeLiveAudio, ensureAudioStarted, getEngine, play, previewSlot, warmUpOnFirstGesture } from '../src/audio/context';
import { getPlayhead } from '../src/audio/playhead';

let removeWarmUp: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  audio.context.state = 'suspended';
  audio.start.mockReset().mockImplementation(() => {
    audio.context.state = 'running';
    return Promise.resolve();
  });
  const events = new EventTarget();
  vi.stubGlobal('window', {
    addEventListener: events.addEventListener.bind(events),
    // Node's EventTarget requires an options object to remove a capture listener.
    removeEventListener: (type: string, handler: EventListener, capture: boolean) => events.removeEventListener(type, handler, { capture }),
    dispatchEvent: events.dispatchEvent.bind(events),
  });
});

afterEach(() => {
  removeWarmUp?.();
  removeWarmUp = undefined;
  disposeLiveAudio();
  vi.unstubAllGlobals();
});

describe('live audio startup on iPad', () => {
  it('requests audio immediately and creates a single engine for concurrent callers', async () => {
    const first = ensureAudioStarted();
    const second = ensureAudioStarted();
    expect(audio.start).toHaveBeenCalled();
    expect(await first).toBe(await second);
    expect(audio.createEngine).toHaveBeenCalledTimes(1);
  });

  it('retries resume from Play when an earlier gesture left resume pending', async () => {
    let unlock!: () => void;
    audio.start.mockImplementationOnce(() => new Promise<void>((resolve) => { unlock = resolve; }));
    const warming = ensureAudioStarted();
    audio.start.mockImplementation(() => {
      audio.context.state = 'running';
      unlock(); // Native resume resolves earlier pending requests once a valid tap unlocks audio.
      return Promise.resolve();
    });

    const playing = play();
    expect(audio.start).toHaveBeenCalledTimes(2);
    await playing;
    expect(await warming).toBe(getEngine());
    expect(audio.createEngine).toHaveBeenCalledTimes(1);
    expect(getPlayhead().playing).toBe(true);
  });

  it.each(['suspended', 'interrupted'])('resumes an existing engine in the %s state before playing', async (state) => {
    await ensureAudioStarted();
    audio.context.state = state;
    const playing = play();
    expect(audio.start).toHaveBeenCalledTimes(2);
    await playing;
    expect(audio.context.state).toBe('running');
    expect(audio.createEngine).toHaveBeenCalledTimes(1);
    expect(audio.transport.start).toHaveBeenCalledOnce();
  });

  it('resumes an existing engine before previewing a Slot', async () => {
    await ensureAudioStarted();
    audio.context.state = 'suspended';
    await previewSlot('kick');
    expect(audio.context.state).toBe('running');
    expect(audio.engine.preview).toHaveBeenCalledWith('kick');
  });

  it('allows another tap after startup rejects', async () => {
    audio.start.mockRejectedValueOnce(new Error('Audio was blocked'));
    await expect(ensureAudioStarted()).rejects.toThrow('Audio was blocked');
    await ensureAudioStarted();
    expect(getEngine()).toBe(audio.engine);
  });

  it('warms audio on a completed tap instead of touch-down, then removes its listeners', async () => {
    removeWarmUp = warmUpOnFirstGesture();
    window.dispatchEvent(new Event('pointerdown'));
    expect(audio.start).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('click'));
    expect(audio.start).toHaveBeenCalledOnce();
    await ensureAudioStarted();
    const calls = audio.start.mock.calls.length;
    window.dispatchEvent(new Event('click'));
    window.dispatchEvent(new Event('keydown'));
    expect(audio.start).toHaveBeenCalledTimes(calls);
  });

  it('keeps warm-up available when a gesture cannot start audio', async () => {
    audio.start.mockRejectedValueOnce(new Error('Audio was blocked'));
    removeWarmUp = warmUpOnFirstGesture();
    window.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(audio.start).toHaveBeenCalledOnce());
    // Let the failed startup clear before the next gesture.
    await Promise.resolve();
    await Promise.resolve();
    window.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(getEngine()).toBe(audio.engine));
    expect(audio.start).toHaveBeenCalledTimes(2);
  });
});
