import dynamic from "next/dynamic";

const OfferCreator = dynamic(() => import("@/components/offer-creator"), {
  ssr: false,
  loading: () => (
    <main className="loading-app">Loading CarePal Offer Letter Creator…</main>
  ),
});

export default function Home() {
  return <OfferCreator />;
}
