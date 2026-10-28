// Giữ sự kiện beforeinstallprompt (Android Chrome/Edge, desktop Chrome) để nút "Cài đặt ứng dụng" gọi hộp thoại cài của máy;
// theo dõi display-mode standalone và sự kiện appinstalled. Không có ở iOS/Firefox → platform thủ công.
import { useCallback, useEffect, useState } from "react";
import { installPlatform } from "../utils/install";

const readStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true);

export default function useInstallPrompt() {
  const [promptEvent, setPromptEvent] = useState(null);
  const [standalone, setStandalone] = useState(readStandalone);
  const [installed, setInstalled] = useState(false);   // vừa cài xong trong phiên này (appinstalled)

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setPromptEvent(e); };
    const onInstalled = () => { setInstalled(true); setPromptEvent(null); };
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const onMode = (e) => setStandalone(e.matches);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    mq?.addEventListener?.("change", onMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      mq?.removeEventListener?.("change", onMode);
    };
  }, []);

  const prompt = useCallback(async () => {
    if (!promptEvent) return "unavailable";
    promptEvent.prompt();
    const choice = await promptEvent.userChoice;   // { outcome: "accepted" | "dismissed" }
    setPromptEvent(null);
    return choice?.outcome || "dismissed";
  }, [promptEvent]);

  const platform = installPlatform({ ua: navigator.userAgent, standalone, hasPromptEvent: !!promptEvent });
  return { platform, standalone, installed, canPrompt: !!promptEvent, prompt };
}
