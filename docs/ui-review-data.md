# UI review data

Run `node scripts/seed-ui-review.mjs USER_ID` only for personal dev `bright-dinosaur-692`. The internal mutation refuses every other deployment.

The repeatable seed retains one synthetic Slack account and replaces only its demo approvals. It preserves real accounts and approvals. It creates three pending requests, three active approvals and 36 history entries, including denied, ended and expired states. Active examples cover no collections, one collection and repeated collection with receipt. Long reasons and names can be reviewed at phone widths. History has enough rows to review pagination.

These are synthetic references. They cannot collect live Slack credentials. Browser decisions and End approval use normal owner mutations. Review at `http://localhost:3000/access`, and use Connections to inspect the collapsed permissions disclosure.
