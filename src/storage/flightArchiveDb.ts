import { parseFlightArchive, type FlightArchive } from '@/game/storage/flightArchive';

const DATABASE = 'orbital-frontier/flights';
const STORE = 'telemetry';
const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined') { reject(new Error('此浏览器不支持IndexedDB')); return; }
  const request = indexedDB.open(DATABASE, 1);
  let expired = false;
  const timeout = setTimeout(() => { expired = true; reject(new Error('存储打开超时，请关闭占用旧版本存档的其它标签页')); }, 5000);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
  };
  request.onsuccess = () => {
    clearTimeout(timeout);
    if (expired) { request.result.close(); return; }
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onerror = () => { clearTimeout(timeout); reject(new Error('无法打开飞行曲线存储')); };
});
// 写入、读取与清空串行，防止“清空后迟到的写入”复活旧档案。
let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(work: () => Promise<T>): Promise<T> => {
  const result = queue.then(work, work);
  queue = result.catch(() => undefined);
  return result;
};
export const saveArchive = (value: FlightArchive, retainedIds: readonly string[]): Promise<void> => serial(async () => {
  const archive = parseFlightArchive(value);
  if (!archive || !retainedIds.includes(archive.id) || retainedIds.length > 50) throw new Error('飞行曲线数据无效');
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('曲线保存失败，可能是存储空间不足'));
      tx.onerror = () => reject(new Error('曲线保存失败'));
      const store = tx.objectStore(STORE);
      store.put(archive);
      const cursor = store.openCursor();
      cursor.onsuccess = () => {
        const item = cursor.result;
        if (!item) return;
        if (!retainedIds.includes(String(item.key))) item.delete();
        item.continue();
      };
    });
  } finally { db.close(); }
});
export const loadArchive = (id: string): Promise<FlightArchive | null> => serial(async () => {
  const db = await openDatabase();
  try {
    return await new Promise<FlightArchive | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(id);
      request.onsuccess = () => {
        if (request.result === undefined) { resolve(null); return; }
        const result = parseFlightArchive(request.result);
        if (!result || result.id !== id) reject(new Error('此条曲线存档已损坏，无法回看'));
        else resolve(result);
      };
      request.onerror = () => reject(new Error('读取飞行曲线失败'));
    });
  } finally { db.close(); }
});
export const clearArchives = (): Promise<void> => serial(async () => {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('清除飞行曲线失败'));
      tx.onerror = () => reject(new Error('清除飞行曲线失败'));
      tx.objectStore(STORE).clear();
    });
  } finally { db.close(); }
});
