import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useVoice } from "../Voice";
import { transcribeVoice } from "../../lib/search";

vi.mock("../../lib/search", () => ({
  transcribeVoice: vi.fn(),
}));

// Mock media devices
const mockGetUserMedia = vi.fn();
Object.defineProperty(global.navigator, "mediaDevices", {
  writable: true,
  value: {
    getUserMedia: mockGetUserMedia,
  },
});

// Mock AudioContext
global.AudioContext = vi.fn().mockImplementation(() => ({
  createMediaStreamSource: vi.fn(() => ({
    connect: vi.fn(),
  })),
  createScriptProcessor: vi.fn(() => ({
    connect: vi.fn(),
    onaudioprocess: null,
  })),
  destination: {},
  sampleRate: 48000,
  close: vi.fn().mockResolvedValue(undefined),
})) as any;

// Mock OfflineAudioContext
global.OfflineAudioContext = vi.fn().mockImplementation(() => ({
  createBuffer: vi.fn(() => ({
    getChannelData: vi.fn(() => new Float32Array(100)),
  })),
  createBufferSource: vi.fn(() => ({
    buffer: null,
    connect: vi.fn(),
    start: vi.fn(),
  })),
  destination: {},
  startRendering: vi.fn().mockResolvedValue({
    getChannelData: vi.fn(() => new Float32Array(100)),
  }),
})) as any;

describe("Voice.tsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    // Default mock: successful media stream
    const mockTrack = {
      stop: vi.fn(),
    };
    const mockStream = {
      getTracks: vi.fn(() => [mockTrack]),
    };
    mockGetUserMedia.mockResolvedValue(mockStream);
  });

  describe("useVoice hook", () => {
    it("initializes with off state", () => {
      const { result } = renderHook(() =>
        useVoice({
          onDone: vi.fn(),
          onError: vi.fn(),
        })
      );

      expect(result.current.state).toBe("off");
      expect(result.current.level).toBeNull();
      expect(result.current.heard).toBe("");
    });

    it("transitions to listening state when started", async () => {
      const { result } = renderHook(() =>
        useVoice({
          onDone: vi.fn(),
          onError: vi.fn(),
        })
      );

      await act(async () => {
        await result.current.start();
      });

      await waitFor(() => {
        expect(result.current.state).toBe("listening");
      });
    });

    it("calls transcribeVoice when stopped", async () => {
      vi.mocked(transcribeVoice).mockResolvedValue("test transcription");
      const onDone = vi.fn();

      const { result } = renderHook(() =>
        useVoice({
          onDone,
          onError: vi.fn(),
        })
      );

      await act(async () => {
        await result.current.start();
      });

      await waitFor(() => {
        expect(result.current.state).toBe("listening");
      });

      await act(async () => {
        await result.current.stop();
      });

      await waitFor(() => {
        expect(transcribeVoice).toHaveBeenCalled();
      });
    });

    it("handles transcription errors", async () => {
      const error = "The speech model isn't downloaded yet.";
      vi.mocked(transcribeVoice).mockRejectedValue(new Error(error));
      const onError = vi.fn();

      const { result } = renderHook(() =>
        useVoice({
          onDone: vi.fn(),
          onError,
        })
      );

      await act(async () => {
        await result.current.start();
      });

      await act(async () => {
        await result.current.stop();
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.stringContaining(error));
      });
    });

    it("handles microphone permission denial", async () => {
      mockGetUserMedia.mockRejectedValue(new Error("Permission denied"));
      const onError = vi.fn();

      const { result } = renderHook(() =>
        useVoice({
          onDone: vi.fn(),
          onError,
        })
      );

      await act(async () => {
        await result.current.start();
      });

      await waitFor(() => {
        expect(onError).toHaveBeenCalledWith(expect.stringContaining("microphone"));
      });
    });

    it("cancels recording", async () => {
      const { result } = renderHook(() =>
        useVoice({
          onDone: vi.fn(),
          onError: vi.fn(),
        })
      );

      await act(async () => {
        await result.current.start();
      });

      await waitFor(() => {
        expect(result.current.state).toBe("listening");
      });

      act(() => {
        result.current.cancel();
      });

      expect(result.current.state).toBe("off");
      expect(result.current.heard).toBe("");
    });

    it("stops media tracks on cancel", async () => {
      const mockStop = vi.fn();
      const mockTrack = { stop: mockStop };
      const mockStream = {
        getTracks: vi.fn(() => [mockTrack]),
      };
      mockGetUserMedia.mockResolvedValue(mockStream);

      const { result } = renderHook(() =>
        useVoice({
          onDone: vi.fn(),
          onError: vi.fn(),
        })
      );

      await act(async () => {
        await result.current.start();
      });

      await waitFor(() => {
        expect(result.current.state).toBe("listening");
      });

      act(() => {
        result.current.cancel();
      });

      await waitFor(() => {
        expect(mockStop).toHaveBeenCalled();
      });
    });

    it("does not start if already listening", async () => {
      const { result } = renderHook(() =>
        useVoice({
          onDone: vi.fn(),
          onError: vi.fn(),
        })
      );

      await act(async () => {
        await result.current.start();
      });

      await waitFor(() => {
        expect(result.current.state).toBe("listening");
      });

      const callCount = mockGetUserMedia.mock.calls.length;

      await act(async () => {
        await result.current.start();
      });

      expect(mockGetUserMedia.mock.calls.length).toBe(callCount);
    });

    it("uses chosen microphone from localStorage", async () => {
      localStorage.setItem("wf.mic", "test-mic-id");

      const { result } = renderHook(() =>
        useVoice({
          onDone: vi.fn(),
          onError: vi.fn(),
        })
      );

      await act(async () => {
        await result.current.start();
      });

      await waitFor(() => {
        expect(mockGetUserMedia).toHaveBeenCalledWith(
          expect.objectContaining({
            audio: expect.objectContaining({
              deviceId: { ideal: "test-mic-id" },
            }),
          })
        );
      });
    });

    it("returns empty text for very short audio", async () => {
      vi.mocked(transcribeVoice).mockResolvedValue("");
      const onDone = vi.fn();

      const { result } = renderHook(() =>
        useVoice({
          onDone,
          onError: vi.fn(),
        })
      );

      await act(async () => {
        await result.current.start();
      });

      // Immediately stop (very short recording)
      await act(async () => {
        await result.current.stop();
      });

      await waitFor(() => {
        expect(onDone).toHaveBeenCalledWith("");
      });
    });

    it("cleans up on unmount", async () => {
      const mockStop = vi.fn();
      const mockTrack = { stop: mockStop };
      const mockStream = {
        getTracks: vi.fn(() => [mockTrack]),
      };
      mockGetUserMedia.mockResolvedValue(mockStream);

      const { result, unmount } = renderHook(() =>
        useVoice({
          onDone: vi.fn(),
          onError: vi.fn(),
        })
      );

      await act(async () => {
        await result.current.start();
      });

      await waitFor(() => {
        expect(result.current.state).toBe("listening");
      });

      unmount();

      expect(mockStop).toHaveBeenCalled();
    });
  });

  describe("voice state transitions", () => {
    it("transitions: off -> listening -> transcribing -> off", async () => {
      vi.mocked(transcribeVoice).mockResolvedValue("test result");
      const onDone = vi.fn();

      const { result } = renderHook(() =>
        useVoice({
          onDone,
          onError: vi.fn(),
        })
      );

      expect(result.current.state).toBe("off");

      await act(async () => {
        await result.current.start();
      });

      await waitFor(() => {
        expect(result.current.state).toBe("listening");
      });

      await act(async () => {
        await result.current.stop();
      });

      // Should transition through transcribing
      await waitFor(() => {
        expect(result.current.state).toBe("off");
      });

      expect(onDone).toHaveBeenCalledWith("test result");
    });

    it("ignores stop when not listening", () => {
      const { result } = renderHook(() =>
        useVoice({
          onDone: vi.fn(),
          onError: vi.fn(),
        })
      );

      expect(() => {
        result.current.stop();
      }).not.toThrow();
    });
  });
});
