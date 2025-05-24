// src/lib/mips-decoder.ts

/**
 * MIPS Instruction Decoder
 * 
 * Este módulo es el corazón de nuestro detector de hazards. Piensa en él como un traductor
 * que convierte las instrucciones hexadecimales en información estructurada que nos permite
 * entender exactamente qué registros lee y escribe cada instrucción.
 * 
 * Imagina que cada instrucción MIPS es como una receta de cocina, y este decodificador
 * nos dice qué ingredientes necesita (registros que lee) y qué plato produce (registros
 * que escribe). Con esta información, podemos detectar cuándo una "receta" necesita un
 * "ingrediente" que otra "receta" aún está preparando.
 */

export interface DecodedInstruction {
  hex: string;
  opcode: number;
  type: 'R' | 'I' | 'J';
  rs?: number;  // Source register 1
  rt?: number;  // Source register 2 / Target for I-type
  rd?: number;  // Destination register for R-type
  immediate?: number;
  isLoad: boolean;
  isStore: boolean;
  readsFrom: number[];  // Registros que lee esta instrucción
  writesTo: number[];   // Registros que escribe esta instrucción
}

/**
 * Convierte una instrucción hexadecimal a binario de 32 bits
 */
function hexToBinary(hex: string): string {
  const cleanHex = hex.replace(/^0x/, '');
  const decimal = parseInt(cleanHex, 16);
  return decimal.toString(2).padStart(32, '0');
}

/**
 * Extrae bits de una posición específica
 */
function extractBits(binary: string, start: number, length: number): number {
  const bits = binary.slice(start, start + length);
  return parseInt(bits, 2);
}

/**
 * Decodifica una instrucción MIPS hexadecimal
 */
export function decodeMIPSInstruction(hex: string): DecodedInstruction {
  const binary = hexToBinary(hex);
  
  // Extraer opcode (bits 0-5)
  const opcode = extractBits(binary, 0, 6);
  
  let instruction: DecodedInstruction = {
    hex,
    opcode,
    type: 'R',
    isLoad: false,
    isStore: false,
    readsFrom: [],
    writesTo: []
  };

  if (opcode === 0) {
    // R-type instruction
    const rs = extractBits(binary, 6, 5);
    const rt = extractBits(binary, 11, 5);
    const rd = extractBits(binary, 16, 5);
    const funct = extractBits(binary, 26, 6);
    
    instruction.type = 'R';
    instruction.rs = rs;
    instruction.rt = rt;
    instruction.rd = rd;
    
    // Para R-type, típicamente lee de rs y rt, escribe a rd
    if (rs !== 0) instruction.readsFrom.push(rs);
    if (rt !== 0) instruction.readsFrom.push(rt);
    if (rd !== 0) instruction.writesTo.push(rd);
    
  } else {
    // I-type instruction
    const rs = extractBits(binary, 6, 5);
    const rt = extractBits(binary, 11, 5);
    const immediate = extractBits(binary, 16, 16);
    
    instruction.type = 'I';
    instruction.rs = rs;
    instruction.rt = rt;
    instruction.immediate = immediate;
    
    // Determinar el tipo específico de instrucción I-type
    switch (opcode) {
      case 0x23: // lw (load word)
        instruction.isLoad = true;
        if (rs !== 0) instruction.readsFrom.push(rs); // dirección base
        if (rt !== 0) instruction.writesTo.push(rt);  // registro destino
        break;
        
      case 0x2B: // sw (store word)
        instruction.isStore = true;
        if (rs !== 0) instruction.readsFrom.push(rs); // dirección base
        if (rt !== 0) instruction.readsFrom.push(rt); // valor a almacenar
        break;
        
      case 0x08: // addi
      case 0x09: // addiu
      case 0x0C: // andi
      case 0x0D: // ori
      case 0x0E: // xori
      case 0x0A: // slti
      case 0x0B: // sltiu
        // Instrucciones aritméticas inmediatas
        if (rs !== 0) instruction.readsFrom.push(rs);
        if (rt !== 0) instruction.writesTo.push(rt);
        break;
        
      default:
        // Para otras I-type, asumir patrón similar
        if (rs !== 0) instruction.readsFrom.push(rs);
        if (rt !== 0) instruction.writesTo.push(rt);
        break;
    }
  }
  
  return instruction;
}

/**
 * Detecta si existe un hazard RAW entre dos instrucciones
 */
export function hasRAWHazard(producer: DecodedInstruction, consumer: DecodedInstruction): boolean {
  // Un hazard RAW ocurre cuando una instrucción lee un registro que la anterior escribe
  return producer.writesTo.some(reg => consumer.readsFrom.includes(reg));
}

/**
 * Determina si un hazard puede ser resuelto con forwarding
 */
export function canForward(producer: DecodedInstruction, consumer: DecodedInstruction, stageDistance: number): boolean {
  if (!hasRAWHazard(producer, consumer)) {
    return false; // No hay hazard para resolver
  }
  
  // Load-use hazard: necesita al menos un stall incluso con forwarding
  if (producer.isLoad && stageDistance === 1) {
    return false;
  }
  
  // Para otras instrucciones, el forwarding puede resolver el hazard
  // si la instrucción productora está en EX o más adelante
  return stageDistance >= 1;
}

/**
 * Calcula cuántos stalls se necesitan para resolver un hazard
 */
export function calculateStallsNeeded(producer: DecodedInstruction, consumer: DecodedInstruction, stageDistance: number): number {
  if (!hasRAWHazard(producer, consumer)) {
    return 0;
  }
  
  // Load-use hazard: necesita 1 stall mínimo
  if (producer.isLoad && stageDistance === 1) {
    return 1;
  }
  
  // Sin forwarding, necesita esperar hasta que el resultado esté disponible
  // R-type y la mayoría de I-type: resultado disponible después de EX (2 ciclos desde ID)
  // Load: resultado disponible después de MEM (3 ciclos desde ID)
  const cyclesUntilResult = producer.isLoad ? 3 : 2;
  const stallsNeeded = Math.max(0, cyclesUntilResult - stageDistance);
  
  return stallsNeeded;
}