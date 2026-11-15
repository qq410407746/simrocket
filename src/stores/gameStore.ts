/**
 * 游戏级状态：当前界面、玩家选择、设置。持久化到 LocalStorage（本地存档的第一步）。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_LAUNCH_SITE_ID, findLaunchSite } from '@/data/launchSites';
import { DEFAULT_VEHICLE_ID, findVehicle } from '@/data/vehicles';

export type Screen = 'menu' | 'flight';

/** 摄像机模式。 */
export type CameraMode = 'chase' | 'free' | 'pad' | 'orbit' | 'map';
export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'free', 'pad', 'orbit', 'map'];

/** 出发点：发射台，或直接从 200 km 近地轨道开始（沙盒用，跳过上升段）。 */
export type StartMode = 'pad' | 'orbit';

export type GraphicsQuality = 'low' | 'medium' | 'high';

interface GameState {
  screen: Screen;
  vehicleId: string;
  siteId: string;
  cameraMode: CameraMode;
  startMode: StartMode;
  quality: GraphicsQuality;
  selectVehicle: (id: string) => void;
  selectSite: (id: string) => void;
  enterFlight: () => void;
  returnToMenu: () => void;
  setCameraMode: (mode: CameraMode) => void;
  setStartMode: (mode: StartMode) => void;
  setQuality: (quality: GraphicsQuality) => void;
}

export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      screen: 'menu',
      vehicleId: DEFAULT_VEHICLE_ID,
      siteId: DEFAULT_LAUNCH_SITE_ID,
      cameraMode: 'chase',
      startMode: 'pad',
      quality: 'high',
      selectVehicle: (id) => {
        if (findVehicle(id)) set({ vehicleId: id });
      },
      selectSite: (id) => {
        if (findLaunchSite(id)) set({ siteId: id });
      },
      enterFlight: () => set({ screen: 'flight', cameraMode: 'chase' }),
      returnToMenu: () => set({ screen: 'menu' }),
      setCameraMode: (cameraMode) => set({ cameraMode }),
      setStartMode: (startMode) => set({ startMode }),
      setQuality: (quality) => set({ quality }),
    }),
    {
      name: 'orbital-frontier/game',
      version: 1,
      // 只持久化玩家选择与设置；每次打开都从主菜单开始。
      partialize: (state) => ({ vehicleId: state.vehicleId, siteId: state.siteId, quality: state.quality }),
      // 存档可能引用已不存在的型号/发射场：回退到默认值。
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<GameState>;
        return {
          ...current,
          vehicleId: saved.vehicleId && findVehicle(saved.vehicleId) ? saved.vehicleId : current.vehicleId,
          siteId: saved.siteId && findLaunchSite(saved.siteId) ? saved.siteId : current.siteId,
          quality:
            saved.quality === 'low' || saved.quality === 'medium' || saved.quality === 'high'
              ? saved.quality
              : current.quality,
        };
      },
    },
  ),
);
