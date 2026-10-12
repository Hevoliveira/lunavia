import { useRef } from "react";
import OpeningScene from "@/components/opening/OpeningScene";

/**
 * Behind the main menu: the expedition's command and service module alone in
 * lunar orbit (the lunar module has gone down to land), the camera drifting
 * slowly round it. The same scene as the opening, lighter: no lunar module, a
 * capped pixel ratio. data/openingSequence loopCamera.
 */
export default function TitleLoop() {
  const clockRef = useRef(0);
  return <OpeningScene clockRef={clockRef} mode="loop" dpr={[1, 1.5]} testId="title-loop" />;
}
