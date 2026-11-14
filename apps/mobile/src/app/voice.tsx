import { Redirect } from 'expo-router';

/** `docket://voice` (widgets, shortcuts): open the assistant and start listening right away. */
export default function VoiceLink() {
  return <Redirect href={{ pathname: '/assistant', params: { listen: '1' } }} />;
}
