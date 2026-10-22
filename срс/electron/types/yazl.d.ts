
declare module 'yazl' {
  import type { Readable } from 'node:stream';

  export class ZipFile {
    
    readonly outputStream: Readable;
    
    addFile(realPath: string, metadataPath: string): void;
    
    addBuffer(buffer: Buffer, metadataPath: string): void;
    
    end(): void;
  }
}
