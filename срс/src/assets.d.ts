
declare module '*?raw' {
  const text: string;
  export default text;
}
declare module '*?inline' {
  const url: string;
  export default url;
}


declare const __DEV_BUILD__: boolean;
