import { Badge } from '@/components/ui/badge';


// Componente para mostrar información detallada de una instrucción
interface InstructionDetailProps {
  hex: string;
  decoded: any;
  isStall: boolean;
}

function InstructionTooltip({ hex, decoded, isStall }: InstructionDetailProps) {
  if (isStall) {
    return (
      <div className="text-xs space-y-1">
        <div className="font-medium text-orange-600">STALL (Bubble)</div>
        <div className="text-muted-foreground">Pipeline paused due to hazard</div>
      </div>
    );
  }

  return (
    <div className="text-xs space-y-1">
      <div className="font-medium">{hex}</div>
      <div className="text-muted-foreground">
        {decoded.isLoad && <Badge variant="outline" className="text-xs mr-1">Load</Badge>}
        {decoded.isStore && <Badge variant="outline" className="text-xs mr-1">Store</Badge>}
        Type: {decoded.type}
      </div>
      {decoded.readsFrom.length > 0 && (
        <div>Reads: R{decoded.readsFrom.join(', R')}</div>
      )}
      {decoded.writesTo.length > 0 && (
        <div>Writes: R{decoded.writesTo.join(', R')}</div>
      )}
    </div>
  );
}

export default InstructionTooltip;