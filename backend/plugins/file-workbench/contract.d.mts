import type { Schema } from "../../contract.mjs"
export type RegisteredFileOperation = {
  title: string
  module: string
  input: Schema
  output: Schema
  example: object
  scope: "session"
  remote: true
  effect: string
  condition: string
  errors: string
}
export const fileOperations: Record<string, RegisteredFileOperation>
export const fileModule: {
  source: string
  storage: string
  responsibility: string
}
