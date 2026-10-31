/* qrcode-generator@1.4.4（MIT, © Kazuhiko Arase）的类型声明。
   仅声明本应用用到的面：typeNumber 传 0 = 自动选版本，errorCorrectionLevel "L"|"M"|"Q"|"H"。 */
declare const qrcode: (typeNumber: number, errorCorrectionLevel: string) => {
  addData(data: string, mode?: string): void;
  make(): void;
  getModuleCount(): number;
  isDark(row: number, col: number): boolean;
};
export default qrcode;
