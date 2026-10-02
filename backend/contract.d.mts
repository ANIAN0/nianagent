import type { ModelOperation } from "../src/features/models/model-contract.generated"
export type Schema = { $ref?: string; type?: string; description?: string; enum?: (string|number|boolean)[]; properties?: Record<string,Schema>; required?: string[]; items?: Schema; anyOf?: Schema[]; minimum?: number; minLength?: number; maxLength?: number; maxItems?: number; pattern?: string; additionalProperties?: boolean }
export const schemas: Record<string,Schema>
export const operations: Record<ModelOperation,{title:string;input:string[];result:string;effect:string;example:unknown;request:Schema;response:Schema;condition:string;errors:string;method:string;args:string[]}>
export function validateRequest(operation:string,input:unknown):typeof operations[ModelOperation]
export function assertSchema(schema:Schema,value:unknown,path?:string):void
