import { useEffect } from "react";
import { useAppStore } from "./stores/useAppStore";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import CentralPanel from "./components/CentralPanel";
import HashtagPanel from "./components/HashtagPanel";
import StatusBar from "./components/StatusBar";
import SettingsModal from "./components/SettingsModal";
import FilePicker from "./components/FilePicker";
import ProjectFormModal from "./components/ProjectFormModal";
import SearchModal from "./components/SearchModal";

export default function App() {
  const init = useAppStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  // Font zoom: Ctrl/Cmd + / - / 0 and Ctrl/Cmd + wheel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const { fontScale, setFontScale } = useAppStore.getState();
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setFontScale(fontScale + 0.1);
      } else if (e.key === "-") {
        e.preventDefault();
        setFontScale(fontScale - 0.1);
      } else if (e.key === "0") {
        e.preventDefault();
        setFontScale(1);
      } else if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        useAppStore.getState().setSearchOpen(true);
      }
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const { fontScale, setFontScale } = useAppStore.getState();
      setFontScale(fontScale + (e.deltaY < 0 ? 0.1 : -0.1));
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col bg-[var(--bg)] text-[var(--text)]">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <CentralPanel />
        </main>
        <HashtagPanel />
      </div>
      <StatusBar />
      <SettingsModal />
      <FilePicker />
      <ProjectFormModal />
      <SearchModal />
    </div>
  );
}
