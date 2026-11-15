/**
 * 游戏级状态：当前界面、玩家选择、设置。持久化到 LocalStorage（本地存档的第一步）。
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_LAUNCH_SITE_ID, findLaunchSite } from '@/data/launchSites';
import { MISSION_CATALOG, findMission } from '@/data/missions';
import { DEFAULT_VEHICLE_ID, findVehicle } from '@/data/vehicles';

export type Screen = 'menu' | 'flight';

/** 摄像机模式。 */
export type CameraMode = 'chase' | 'free' | 'pad' | 'orbit' | 'map';
export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'free', 'pad', 'orbit', 'map'];

/** 出发点：发射台，或直接从 200 km 近地轨道开始（沙盒用，跳过上升段）。 */
export type StartMode = 'pad' | 'orbit';

export type GraphicsQuality = 'low' | 'medium' | 'high';

/** 主菜单的页签：任务、自由飞行（沙盒）、飞行记录。 */
export type MenuTab = 'missions' | 'sandbox' | 'logbook';

interface GameState {
  screen: Screen;
  vehicleId: string;
  siteId: string;
  cameraMode: CameraMode;
  startMode: StartMode;
  quality: GraphicsQuality;
  menuTab: MenuTab;
  /** 主菜单任务列表里选中的任务。 */
  selectedMissionId: string;
  /** 当前飞行所属的任务；自由飞行时为 null。 */
  missionId: string | null;
  /** 每次开始任务时加一：即使火箭、发射场都没变，也要从头开始一次新的飞行。 */
  launchSerial: number;
  selectVehicle: (id: string) => void;
  selectSite: (id: string) => void;
  /** 以当前选择的火箭与发射场进入自由飞行。 */
  enterFlight: () => void;
  /** 开始一个任务：使用任务规定的火箭、发射场与出发点。 */
  startMission: (id: string) => void;
  returnToMenu: () => void;
  setMenuTab: (tab: MenuTab) => void;
  selectMission: (id: string) => void;
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
      menuTab: 'missions',
      selectedMissionId: (MISSION_CATALOG[0] as (typeof MISSION_CATALOG)[number]).id,
      missionId: null,
      launchSerial: 0,
      selectVehicle: (id) => {
        if (findVehicle(id)) set({ vehicleId: id });
      },
      selectSite: (id) => {
        if (findLaunchSite(id)) set({ siteId: id });
      },
      enterFlight: () => set({ screen: 'flight', cameraMode: 'chase', missionId: null }),
      startMission: (id) => {
        const mission = findMission(id);
        if (!mission || !findVehicle(mission.vehicleId) || !findLaunchSite(mission.siteId)) return;
        set((state) => ({
          screen: 'flight',
          cameraMode: 'chase',
          missionId: mission.id,
          selectedMissionId: mission.id,
          vehicleId: mission.vehicleId,
          siteId: mission.siteId,
          startMode: mission.start,
          launchSerial: state.launchSerial + 1,
        }));
      },
      returnToMenu: () => set({ screen: 'menu', missionId: null }),
      setMenuTab: (menuTab) => set({ menuTab }),
      selectMission: (id) => {
        if (findMission(id)) set({ selectedMissionId: id });
      },
      setCameraMode: (cameraMode) => set({ cameraMode }),
      setStartMode: (startMode) => set({ startMode }),
      setQuality: (quality) => set({ quality }),
    }),
    {
      name: 'orbital-frontier/game',
      version: 1,
      // 只持久化玩家选择与设置；每次打开都从主菜单开始。
      partialize: (state) => ({
        vehicleId: state.vehicleId,
        siteId: state.siteId,
        quality: state.quality,
        menuTab: state.menuTab,
        selectedMissionId: state.selectedMissionId,
      }),
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
          menuTab: saved.menuTab === 'missions' || saved.menuTab === 'sandbox' || saved.menuTab === 'logbook' ? saved.menuTab : current.menuTab,
          selectedMissionId: saved.selectedMissionId && findMission(saved.selectedMissionId) ? saved.selectedMissionId : current.selectedMissionId,
        };
      },
    },
  ),
);
