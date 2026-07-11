import { NextFunction, Request, Response } from 'express';
import { ModuleKey } from '../db';
import { isModuleEnabled } from '../lib/modules';
import { ApiError } from './errors';

/**
 * Stellt sicher, dass das angegebene Modul im aktuellen Bereich (req.spaceId)
 * aktiviert ist. Muss NACH requireSpace verwendet werden. Deaktivierte Module
 * liefern 403 – die Daten bleiben in der DB, sind aber nicht erreichbar.
 */
export function requireEnabledModule(moduleKey: ModuleKey) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.spaceId) throw new ApiError(401, 'Kein Zugriff – bitte Bereich öffnen.');
    if (!isModuleEnabled(req.spaceId, moduleKey)) {
      throw new ApiError(403, 'Dieses Modul ist in diesem Bereich nicht aktiviert.');
    }
    next();
  };
}
