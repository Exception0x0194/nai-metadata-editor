import pako from 'pako';

class DataReader {
    constructor(data) {
        this.data = data;
        this.index = 0;
    }

    readBit() {
        return this.data[this.index++];
    }

    readNBits(n) {
        let bits = [];
        for (let i = 0; i < n; i++) {
            bits.push(this.readBit());
        }
        return bits;
    }

    readByte() {
        let byte = 0;
        for (let i = 0; i < 8; i++) {
            byte |= this.readBit() << (7 - i);
        }
        return byte;
    }

    readNBytes(n) {
        let bytes = [];
        for (let i = 0; i < n; i++) {
            bytes.push(this.readByte());
        }
        return bytes;
    }

    readInt32() {
        let bytes = this.readNBytes(4);
        return new DataView(new Uint8Array(bytes).buffer).getInt32(0, false);
    }
}

class DataWriter {
    constructor() {
        this.data = [];
    }

    writeBit(bit) {
        this.data.push(bit);
    }

    writeNBits(bits) {
        for (let bit of bits) {
            this.writeBit(bit);
        }
    }

    writeByte(byte) {
        for (let i = 7; i >= 0; i--) {
            this.writeBit((byte >> i) & 1);
        }
    }

    writeNBytes(bytes) {
        for (let byte of bytes) {
            this.writeByte(byte);
        }
    }

    writeInt32(value) {
        let buffer = new ArrayBuffer(4);
        let view = new DataView(buffer);
        view.setInt32(0, value, false);
        for (let i = 0; i < 4; i++) {
            this.writeByte(view.getUint8(i));
        }
    }

    getData() {
        return this.data;
    }
}

export const asyncFileReaderAsDataURL = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            resolve(e.target.result);
        };
        reader.onerror = (e) => {
            reject(e);
        };
        reader.readAsDataURL(file);
    });
};

export const tryExtractSafetensorsMeta = (content) => {
    const jsonKeys = ["ss_bucket_info", "ss_network_args", "ss_dataset_dirs", "ss_tag_frequency"]
    let metadataStr = '{';
    let i = content.indexOf('__metadata__');
    if (i == -1) {
        console.log("no metadata found")
        return null;
    }
    i += 15; // skip `__metadata__':{`
    let braceCount = 1;
    while (braceCount > 0 && i < content.length) {
        metadataStr += content[i];
        if (content[i] === '{') {
            braceCount++;
        } else if (content[i] === '}') {
            braceCount--;
        }
        i++;
    }
    console.log("[debug] metadata: "+metadataStr)
    const data = JSON.parse(metadataStr);
    for (let k of jsonKeys) {
        if (data[k]) {
            data[k] = JSON.parse(data[k])
        }
    }
    return data;
};

export async function getStealthExif(src) {
    let time = performance.now();

    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
    let img = new Image();
    img.src = src;

    await img.decode();

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    let imageData = ctx.getImageData(0, 0, img.width, img.height);
    let lowestData = [];

    for (let x = 0; x < img.width; x++) {
        for (let y = 0; y < img.height; y++) {
            let index = (y * img.width + x) * 4;
            let a = imageData.data[index + 3];
            lowestData.push(a & 1);
        }
    }

    console.log("Time taken: ", performance.now() - time, "ms");

    const magic = "stealth_pngcomp";
    const reader = new DataReader(lowestData);
    const readMagic = reader.readNBytes(magic.length);
    const magicString = String.fromCharCode.apply(null, readMagic);

    if (magic === magicString) {
        const dataLength = reader.readInt32();
        const gzipData = reader.readNBytes(dataLength / 8);
        const data = pako.ungzip(new Uint8Array(gzipData));
        const jsonString = new TextDecoder().decode(new Uint8Array(data));
        const json = JSON.parse(jsonString);
        return json;
    } else {
        console.log("Magic number not found.");
    }

    return null;
}

export async function embedStealthExif(imgSrc, text) {
    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
    let img = new Image();
    img.src = imgSrc;

    await img.decode();

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    let imageData = ctx.getImageData(0, 0, img.width, img.height);
    let dataWriter = new DataWriter();

    const magic = "stealth_pngcomp";
    dataWriter.writeNBytes(magic.split('').map(c => c.charCodeAt(0)));

    const compressedText = pako.gzip(text);
    dataWriter.writeInt32(compressedText.length * 8); // data length in bits
    dataWriter.writeNBytes(new Uint8Array(compressedText));

    let bits = dataWriter.getData();
    let bitIndex = 0;

    for (let x = 0; x < img.width; x++) {
        for (let y = 0; y < img.height; y++) {
            let index = (y * img.width + x) * 4;
            if (bitIndex < bits.length) {
                imageData.data[index + 3] = (imageData.data[index + 3] & 0xFE) | bits[bitIndex];
                bitIndex++;
            } else {
                break;
            }
        }
        if (bitIndex >= bits.length) {
            break;
        }
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL(); // 返回嵌入水印后的图片数据URL
}