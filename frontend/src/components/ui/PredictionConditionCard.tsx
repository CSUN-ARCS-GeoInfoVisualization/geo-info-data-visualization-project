import { Eye } from "lucide-react";
import { ConditionCard } from "./condition-card";
import PredictionPanel from "./PredictionPanel";

export default function PredictionConditionCard() {
  return (
    <ConditionCard
      title="Visibility (Prediction)"
      value=""
      icon={Eye}
      trend="stable"
      trendValue=""
    >
      <div className="mt-4">
        <PredictionPanel />
      </div>
    </ConditionCard>
  );
}