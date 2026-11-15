import { useTexture } from '@react-three/drei';
import { useMemo } from 'react';
import {
  ClampToEdgeWrapping,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { EARTH } from '@/game/physics/constants';
import { TRANSMITTANCE_LUT, buildTransmittanceLutData } from './atmosphereModel';

const base = import.meta.env.BASE_URL;

/** 地球贴图（等距圆柱投影，u = 0 对应西经 180°，v = 1 对应北极）。来源见 README「素材来源」。 */
const TEXTURE_URLS = {
  day: `${base}textures/earth/day_4k.jpg`,
  night: `${base}textures/earth/night_4k.jpg`,
  water: `${base}textures/earth/water_2k.jpg`,
  clouds: `${base}textures/earth/clouds_4k.jpg`,
};

export interface EarthTextures {
  readonly day: Texture;
  readonly night: Texture;
  readonly water: Texture;
  readonly clouds: Texture;
}

const EQUATOR_KM = (2 * Math.PI * EARTH.RADIUS) / 1000;

/** 贴图在赤道处每个纹素对应的地面距离 [km]。 */
export const texelSizeKm = (texture: Texture): number => {
  const image = texture.image as { width?: number } | undefined;
  return EQUATOR_KM / Math.max(1, image?.width ?? 2048);
};

const configure = (texture: Texture, srgb: boolean): void => {
  texture.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
};

/** 加载并配置地球贴图（Suspense）。同一 URL 在各组件间共享同一个纹理对象。 */
export const useEarthTextures = (): EarthTextures => {
  const textures = useTexture(TEXTURE_URLS);
  return useMemo(() => {
    configure(textures.day, true);
    configure(textures.night, true);
    configure(textures.water, false);
    configure(textures.clouds, false);
    return textures;
  }, [textures]);
};

let transmittanceLut: DataTexture | null = null;

/** 大气透射率查找表纹理（半精度浮点，全局共享，只生成一次）。 */
export const getTransmittanceLut = (): DataTexture => {
  if (transmittanceLut) return transmittanceLut;
  const data = buildTransmittanceLutData();
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = DataUtils.toHalfFloat(data[i] as number);
  const texture = new DataTexture(half, TRANSMITTANCE_LUT.WIDTH, TRANSMITTANCE_LUT.HEIGHT, RGBAFormat, HalfFloatType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.colorSpace = NoColorSpace;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  transmittanceLut = texture;
  return texture;
};
