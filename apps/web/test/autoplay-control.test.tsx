// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutoplayStop, useAutoplayControl } from "../src/demos/autoplay-control";

/** A demo whose autoplay plays from the start until "finish" or until it is stopped. */
function FakeDemo(props: { onStopped: () => void }) {
  const [playing, setPlaying] = useState(true);
  useAutoplayControl(playing, () => {
    props.onStopped();
    setPlaying(false);
  });
  return (
    <button type="button" onClick={() => setPlaying(false)}>
      finish
    </button>
  );
}

const stopButton = () => screen.queryByRole("button", { name: "Stop demo" });

afterEach(cleanup);

describe("demo autoplay control (WCAG 2.2.2)", () => {
  it("shows Stop demo before the demo while it plays, and stops it once", () => {
    const stopped = vi.fn();
    const onStop = vi.fn();
    render(
      <AutoplayStop onStop={onStop}>
        <FakeDemo onStopped={stopped} />
      </AutoplayStop>,
    );
    const button = stopButton();
    expect(button?.compareDocumentPosition(screen.getByText("finish"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    fireEvent.click(button as HTMLElement);
    expect(stopped).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(stopButton()).toBeNull();
  });

  it("hides the control when the autoplay ends by itself", () => {
    render(
      <AutoplayStop>
        <FakeDemo onStopped={vi.fn()} />
      </AutoplayStop>,
    );
    expect(stopButton()).not.toBeNull();
    fireEvent.click(screen.getByText("finish"));
    expect(stopButton()).toBeNull();
  });

  it("lets a demo run without a page control", () => {
    const stopped = vi.fn();
    render(<FakeDemo onStopped={stopped} />);
    expect(stopButton()).toBeNull();
    expect(stopped).not.toHaveBeenCalled();
  });
});
