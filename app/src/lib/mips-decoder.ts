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

export function decodeHexToInstructions(hexInstruction: DecodedInstruction, instIndex: number): string {
  if (!hexInstruction) return `Inst ${instIndex + 1}`;

  // Formatear el código decodificado según el tipo
  if (hexInstruction.type === 'R') {
    // Formato R: op rd, rs, rt
    const opNames: { [key: number]: string } = {
      0: 'add', // Ejemplo - necesitarás expandir esto
      2: 'sub',
      // Agregar más según tus opcodes
    };
    const opName = opNames[hexInstruction.opcode] || `r${hexInstruction.opcode}`;
    return `${opName} $${hexInstruction.rd}, $${hexInstruction.rs}, $${hexInstruction.rt}`;
  } else if (hexInstruction.type === 'I') {
    // Formato I: op rt, rs, immediate
    const opNames: { [key: number]: string } = {
      8: 'addi',
      35: 'lw',
      43: 'sw',
      4: 'beq',
      5: 'bne',
      // Agregar más según tus opcodes
    };
    const opName = opNames[hexInstruction.opcode] || `i${hexInstruction.opcode}`;
    if (hexInstruction.isLoad || hexInstruction.isStore) {
      return `${opName} $${hexInstruction.rt}, ${hexInstruction.immediate}($${hexInstruction.rs})`;
    } else {
      return `${opName} $${hexInstruction.rt}, $${hexInstruction.rs}, ${hexInstruction.immediate}`;
    }
  } else if (hexInstruction.type === 'J') {
    // Formato J: op address
    const opNames: { [key: number]: string } = {
      2: 'j',
      3: 'jal',
      // Agregar más según tus opcodes
    };
    const opName = opNames[hexInstruction.opcode] || `j${hexInstruction.opcode}`;
    return `${opName} ${hexInstruction.immediate || 0}`;
  }
                          
  return `Inst ${instIndex + 1}`;
}

/**
 * Detecta si existe un hazard RAW entre dos instrucciones
 */
export function hasRAWHazard(producer: DecodedInstruction, consumer: DecodedInstruction): boolean {
  // Un hazard RAW ocurre cuando una instrucción lee un registro que la anterior escribe
  return producer.writesTo.some(reg => consumer.readsFrom.includes(reg));
}

/**
 * Detector de forwarding mejorado
 * 
 * Determina si un hazard de datos puede ser resuelto mediante forwarding,
 * considerando el tipo de instrucción y la distancia entre etapas.
 * 
 * @param producer Instrucción que produce el valor (escribe en un registro)
 * @param consumer Instrucción que consume el valor (lee de un registro)
 * @param stageDistance Distancia entre las etapas (2=EX→ID, 3=MEM→ID)
 * @returns Un objeto con información sobre el forwarding
 */
export function canForward(producer: DecodedInstruction, consumer: DecodedInstruction, stageDistance: number): boolean {
  // Verificar si realmente hay un hazard RAW entre estas instrucciones
  const commonRegisters = producer.writesTo.filter(reg => consumer.readsFrom.includes(reg));
  if (!hasRAWHazard(producer, consumer)) {
    return false;
  }
  
  if (producer.isLoad && consumer.isStore) {
    // Load → Store: no se puede hacer forwarding
    return false;
  }
  if (producer.isLoad && stageDistance === 1) {
    return false; // Load-use hazard: no se puede hacer forwarding
  }

  if (producer.isStore && consumer.isLoad) {
    // Store → Load: no se puede hacer forwarding
    return false;
  }

  if (producer.writesTo.length === 0 || consumer.readsFrom.length === 0) {
    return false; // No hay registros comunes
  }
  
  return true;
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