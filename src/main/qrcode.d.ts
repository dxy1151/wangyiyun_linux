/**
 * 最小类型声明：qrcode 包本身未自带 TS 类型（也不引入 @types/qrcode 以免多一个依赖）。
 * 这里只声明主进程用到的 toDataURL。
 */
declare module 'qrcode' {
  export interface QrToDataUrlOptions {
    errorCorrectionLevel?: 'low' | 'medium' | 'quartile' | 'high' | 'L' | 'M' | 'Q' | 'H'
    margin?: number
    width?: number
    scale?: number
    color?: { dark?: string; light?: string }
    type?: string
  }
  export function toDataURL(text: string, options?: QrToDataUrlOptions): Promise<string>
  export function toString(
    text: string,
    options?: QrToDataUrlOptions & { type?: 'svg' | 'utf8' | 'terminal' }
  ): Promise<string>
}
