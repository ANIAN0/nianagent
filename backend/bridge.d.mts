import type { Plugin } from "vite"
export function modelBackendPlugin(): Plugin
export function createBridge(options?: {env?: Record<string,string>}): {call(operation:string,input:unknown,signal?:AbortSignal): Promise<unknown>;close():void}
