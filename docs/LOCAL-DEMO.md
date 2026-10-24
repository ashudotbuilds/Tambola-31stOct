# Local testing workflow

Run `npm run dev:demo` from the repository root. The local API listens on port
3001 and Vite prints the frontend URL. Open that URL to sign in; there is no
public landing page. The sign-in page displays ten testing account buttons.

| Role | IDs | Initial password |
| --- | --- | --- |
| Super Admin | `superadmin` | `DemoPass123!` |
| Admin | `admin1`, `admin2`, `admin3` | `DemoPass123!` |
| Member | `user1` through `user20` | `DemoPass123!` |

The demo runs an isolated in-memory PGlite database. It does not read the cloud
database connection or send email. Data, profile changes, and games reset when
the demo API restarts. Demo accounts and their buttons are unavailable in the
production server. Normal production startup remains `npm start`.

1. Sign in as an Admin and choose **Create a game**. Share the six-character code.
2. Sign in as a member in another browser or browser profile. Enter the game code.
3. The existing lobby tutorial lets the member practice while waiting.
4. Start the game from the Admin console. The member's existing game workflow
   updates through Socket.IO.
5. Return to the Admin workspace to see games, resume a game, and inspect the
   audit trail. Super Admin additionally manages administrators and recovery.

Members see their account name and a code entry form. Account settings support
name, email, and password changes after checking the current password. Login IDs
remain stable when email changes. Changing a password revokes other account
sessions. Account sessions and game access are checked by the API as well as by
the frontend routes.

Use separate browsers/profiles for simultaneous Admin and member sessions:
HTTP cookies are shared between tabs in one browser profile. Game resume data is
stored separately per account, and rejoining by code restores a member's ticket.
