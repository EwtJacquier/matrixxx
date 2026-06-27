declare module "@3d-dice/dice-box" {
  interface DiceBoxConfig {
    assetPath?: string;
    theme?: string;
    themeColor?: string;
    scale?: number;
    gravity?: number;
    [key: string]: unknown;
  }

  export default class DiceBox {
    constructor(selector: string, config?: DiceBoxConfig);
    init(): Promise<void>;
    roll(notation: string): Promise<unknown>;
    clear(): void;
  }
}
