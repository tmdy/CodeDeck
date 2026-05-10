import { memo, type ComponentProps } from "react";
import { SessionList } from "../launcher/SessionList.jsx";
import { ProviderSwitch } from "../profiles/ProviderSwitch.jsx";

interface SessionsPageProps {
  providerSwitchProps: ComponentProps<typeof ProviderSwitch>;
  sessionListProps: ComponentProps<typeof SessionList>;
}

export const SessionsPage = memo(function SessionsPage({
  providerSwitchProps,
  sessionListProps,
}: SessionsPageProps) {
  return (
    <div className="sessions-layout">
      <ProviderSwitch {...providerSwitchProps} />
      <SessionList {...sessionListProps} />
    </div>
  );
});
