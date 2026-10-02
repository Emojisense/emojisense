import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * WCAG 2.2.2: a demo that plays by itself for more than five seconds needs a way to stop it. The
 * demo reports while its autoplay plays, and the page shows a stop control during that time.
 */
interface AutoplayControl {
  /** The visitor pressed the stop control. */
  stopped: boolean;
  setPlaying: (playing: boolean) => void;
}

const AutoplayContext = createContext<AutoplayControl>({ stopped: false, setPlaying: () => {} });

/** For a demo: tells the page when the autoplay plays, and calls `stop` when the visitor stops it. */
export function useAutoplayControl(playing: boolean, stop: () => void): void {
  const { stopped, setPlaying } = useContext(AutoplayContext);
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });
  useEffect(() => {
    setPlaying(playing);
  }, [playing, setPlaying]);
  useEffect(() => () => setPlaying(false), [setPlaying]);
  useEffect(() => {
    if (stopped) stopRef.current();
  }, [stopped]);
}

/** For the page: a "Stop demo" button, shown while the demo inside reports that it plays. */
export function AutoplayStop(props: { children: ReactNode; onStop?: () => void; label?: string }) {
  const [playing, setPlaying] = useState(false);
  const [stopped, setStopped] = useState(false);
  const control = useMemo(() => ({ stopped, setPlaying }), [stopped]);
  return (
    <>
      {playing && !stopped && (
        <button
          type="button"
          className="uc-stop"
          onClick={() => {
            setStopped(true);
            props.onStop?.();
          }}
        >
          {props.label ?? "Stop demo"}
        </button>
      )}
      <AutoplayContext.Provider value={control}>{props.children}</AutoplayContext.Provider>
    </>
  );
}
