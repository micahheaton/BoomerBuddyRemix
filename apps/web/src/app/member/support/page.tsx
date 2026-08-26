import { SupportReceipts } from '../../../components/support-receipts';

export default function MemberSupportPage() {
  return (
    <main id="main-content" className="member-shell member-main">
      <span className="eyebrow">Member support</span>
      <h1 className="member-heading">Ask for help without submitting private content</h1>
      <p className="lede">
        A support receipt tells the owner queue only what area needs help and how strongly it
        affects you. It does not send a message or share contact details.
      </p>
      <SupportReceipts />
    </main>
  );
}
