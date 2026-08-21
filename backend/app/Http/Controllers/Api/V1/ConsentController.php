<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Patients\StoreConsentRequest;
use App\Http\Requests\V1\Patients\WithdrawConsentRequest;
use App\Http\Resources\V1\ConsentRecordResource;
use App\Models\ConsentRecord;
use App\Models\Patient;
use App\Models\PatientStatus;
use App\Models\Tenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Date;
use Illuminate\Validation\ValidationException;

/**
 * DPPA 2019 consent: the record of what a patient was shown and what they said.
 *
 * "Demonstrable" is the operative word in the statute. Months later we must be
 * able to reconstruct exactly what wording a person agreed to, which is why
 * every record pins the policy version AND a hash of the rendered text, and why
 * nothing here ever updates a row -- withdrawal is a new record.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 */
class ConsentController extends Controller
{
    /**
     * Bump on ANY change to the wording below, however small.
     *
     * The version is half of the evidence; the text hash is the other half and
     * catches the change someone forgot to version.
     */
    public const POLICY_VERSION = '2026-08-01';

    /**
     * Separate consents, captured separately. Never an array on the wire.
     *
     * `delivery_disclosure` is deliberately not collected at registration. It
     * is taken at the point the patient chooses delivery (H4), because consent
     * must be specific and asking up front for a disclosure that may never
     * happen is not specific.
     *
     * @var list<string>
     */
    public const CONSENT_TYPES = ['data_processing', 'telemedicine', 'delivery_disclosure'];

    /**
     * The full policy, in the clinic's own voice, in both languages.
     *
     * On screen rather than behind a link: a link nobody opens is not
     * information anybody received. `{clinic}` is the only interpolation, and
     * the hash is taken over the RENDERED text, so what we pin is what the
     * patient actually read.
     *
     * The Luganda rendering below is a working translation and must be reviewed
     * by a native speaker before this policy version ships to patients. Consent
     * obtained from wording the patient did not understand is not consent.
     *
     * @var array<string, string>
     */
    private const POLICY_TEXT = [
        'en' => <<<'TEXT'
        How {clinic} uses your health information

        WHAT WE COLLECT
        Your name, your phone number and any other contact details you give us, plus
        the health information that arises from your care here: what you tell the
        clinician, what they record, what they prescribe, and what the pharmacy
        dispenses.

        HEALTH INFORMATION IS TREATED DIFFERENTLY
        Under Uganda's Data Protection and Privacy Act 2019, health information is
        special-category data. It is held under stronger safeguards than an ordinary
        contact record, and every time a member of staff opens your record that
        access is recorded.

        WHO IS RESPONSIBLE
        {clinic} is responsible for your information and decides how it is used.
        Carevelo supplies and runs the software on the clinic's instructions, and
        does nothing else with your data.

        WHY WE USE IT
        To provide and administer your care. Nothing else. We do not sell it, we do
        not use it for marketing, and we do not use records that identify you for
        research or analytics.

        WHO SEES IT
        The clinicians and pharmacy staff of {clinic} involved in your care. If you
        choose to have medicines delivered, the rider is given your name, your phone
        number, the delivery address and a package reference - never your diagnosis,
        and never a list of your medicines.

        HOW LONG WE KEEP IT
        Your medical record is kept for as long as the law requires {clinic} to keep
        it. Contact details from a registration that was never completed are deleted
        within 30 days.

        YOUR RIGHTS
        You may ask to see your record, ask for a correction, and withdraw your
        consent at any time. Withdrawing stops any new use of your information. It
        does not always delete what already exists - {clinic} may be legally obliged
        to keep your medical record - and we will tell you plainly which parts can be
        removed and which cannot.

        WHAT YOU ARE AGREEING TO
        We ask separately, and you may agree to one and not the other:
        - Data processing: using your information to provide care. Without this,
          nothing can proceed.
        - Telemedicine: consulting a clinician remotely, by video or voice.
        - Delivery disclosure: sharing your address and phone with a delivery rider.
          We ask this only if and when you choose delivery.

        Nothing on this screen is ticked for you, and nothing is agreed by simply
        continuing.
        TEXT,

        'lg' => <<<'TEXT'
        Engeri {clinic} gy'ekozesaamu amawulire go ag'obulamu

        BYE TUKUNG'AANYA
        Erinnya lyo, essimu yo n'ebirala by'otuwa ebiyamba okukutuukirira, awamu
        n'amawulire ag'obulamu agava mu bujjanjabi bwo wano: by'obuulira omusawo,
        by'awandiika, eddagala ly'akuwandiikira, n'eddagala eddwaliro lye likuwa.

        AMAWULIRE AG'OBULAMU GA NJAWULO
        Okusinziira ku tteeka lya Uganda ery'Okukuuma Amawulire n'Eby'ekyama erya
        2019, amawulire ag'obulamu ga kika kya njawulo. Gakuumibwa n'obwegendereza
        obusingako, era buli lwe waba omukozi aggulawo ekiwandiiko kyo, okwo
        kuwandiikibwa.

        ANI AVUNAANYIZIBWA
        {clinic} y'evunaanyizibwa ku mawulire go era y'esalawo engeri gye
        gakozesebwamu. Carevelo ekola era n'eddukanya puloguramu ku biragiro
        by'eddwaliro, era tewali kirala ky'ekola n'amawulire go.

        LWAKI TUGAKOZESA
        Okukuwa n'okuddukanya obujjanjabi bwo. Tewali kirala. Tetugatunda,
        tetugakozesa mu kulanga bya bizinensi, era tetukozesa biwandiiko
        ebikulaga mu kunoonyereza oba mu kwekenneenya.

        ANI AGALABA
        Abasawo n'abakozi b'eddagala aba {clinic} abali mu kukujjanjaba. Bw'osalawo
        okutwalirwa eddagala, oyo alitwala aweebwa erinnya lyo, essimu yo,
        endagiriro n'ennamba y'akapaki - naye tafuna bulwadde bwo era tafuna
        lukalala lwa ddagala lyo.

        TUGAKUUMA BBANGA KI
        Ekiwandiiko kyo eky'obujjanjabi kikuumibwa okumala ebbanga etteeka lye
        ligamba {clinic} okukikuuma. Ebikwata ku kutuukirira eby'okwewandiisa
        okutamalirizibwa bisangulwa mu nnaku 30.

        EDDEMBE LYO
        Osobola okusaba okulaba ekiwandiiko kyo, okusaba kiddaabirizibwe, era
        n'okujjulula okukkiriza kwo mu kiseera kyonna. Okujjulula kuziyiza
        okukozesa okuggya okw'amawulire go. Tekitegeeza nti buli kimu kisangulwa -
        {clinic} eyinza okuba n'obuvunaanyizibwa obw'amateeka okukuuma ekiwandiiko
        kyo - era tujja kukubuulira mu bwesimbu ki ekisoboka okuggyibwawo n'ekitasoboka.

        BY'OKKIRIZA
        Tubuuza buli kimu kyokka, era osobola okukkiriza ekimu n'otakkiriza ekirala:
        - Okukozesa amawulire: okukozesa amawulire go okukuwa obujjanjabi. Nga
          kuno tekuliiwo, tewali kisoboka kugenda mu maaso.
        - Okwebuuza ku musawo ng'oli walala: okwogera n'omusawo mu vidiyo oba ku ssimu.
        - Okumanyisa oyo atwala eddagala: okumuwa endagiriro yo n'essimu yo. Kino
          tukibuuza bwe kiba nti weerondedde okutwalirwa eddagala awaka.

        Tewali kabokisi akakuloboleddwa dda ku lupapula luno, era tewali kikkirizibwa
        lwa kugenda mu maaso kwokka.
        TEXT,
    ];

    public function __construct(protected AuditLog $audit) {}

    /**
     * The current consent policy. PUBLIC, by necessity.
     *
     * A patient has to be able to read what they are agreeing to before they
     * have an account, so this endpoint carries no authentication and no
     * patient data whatsoever -- only the clinic's own name, which the portal
     * already renders in its branding.
     */
    /**
     * The current consent policy, in every language it is published in.
     *
     * THE DOCBLOCK IS LOAD-BEARING. Without it the generator inferred this response from
     * the PHP alone and got two things wrong, both of which reached the typed client the
     * consent screen is built on:
     *
     *   - `text` became `unknown[]`. It is a MAP keyed by language code, not a list, and a
     *     flattened associative array looks like a list to a generator that only sees the
     *     runtime shape. The frontend then had no way to ask for the Luganda text by key.
     *   - `version` became the literal `'2026-08-01'`, because the constant's value was
     *     visible and looked like a fixed part of the contract. It is not — it is the
     *     current value of something designed to change, and the first policy revision
     *     would have broken every generated client against a version they had pinned.
     *
     * The array shape below says what is actually true, and the contract gate regenerates
     * from it. Keep the `string, string` map open-ended: publishing a third language must
     * not be a breaking change to the type.
     *
     * @return JsonResponse
     */
    public function currentPolicy(Request $request): JsonResponse
    {
        $text = $this->renderedPolicy($this->tenantOf($request));

        return response()->json([
            'data' => [
                'version' => self::POLICY_VERSION,
                'text_hash' => $this->policyTextHash($text),
                'consent_types' => self::CONSENT_TYPES,
                // Both languages together, because both are shown together.
                'text' => $text,
            ],
        ]);
    }

    /**
     * The full consent history for one patient.
     *
     * History, not current state: the sequence of decisions IS the evidence, so
     * superseded grants and withdrawals are returned alongside live ones.
     */
    public function index(Patient $patient): AnonymousResourceCollection
    {
        $this->authorize('view', $patient);

        $records = ConsentRecord::query()
            ->where('patient_id', $patient->id)
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->cursorPaginate(25);

        return ConsentRecordResource::collection($records);
    }

    /**
     * Record one consent decision.
     *
     * Both outcomes are recorded. A decline is evidence too: it is what proves
     * we stopped, and it is what a regulator asks for when a patient says they
     * never agreed.
     */
    public function store(StoreConsentRequest $request, Patient $patient): JsonResponse
    {
        $this->authorize('update', $patient);

        /** @var array{consent_type: string, affirmed: bool, policy_version: string, granted_by?: string, guardian_name?: string, guardian_relationship?: string} $validated */
        $validated = $request->validated();

        $type = $validated['consent_type'];
        $affirmed = $validated['affirmed'];
        $grantedBy = $validated['granted_by'] ?? 'patient';

        if ($validated['policy_version'] !== self::POLICY_VERSION) {
            // The client displayed wording we no longer serve. Accepting it
            // would pin a hash to text we cannot reproduce, which is precisely
            // the failure the version exists to prevent.
            throw ValidationException::withMessages([
                'policy_version' => 'The consent wording has changed. Show the current policy and ask again.',
            ]);
        }

        $this->assertDecisionIsPossible($patient, $type, $affirmed, $grantedBy);

        $text = $this->renderedPolicy($this->tenantOf($request));

        $record = ConsentRecord::create([
            'patient_id' => $patient->id,
            'consent_type' => $type,
            'policy_version' => self::POLICY_VERSION,
            'policy_text_hash' => $this->policyTextHash($text),
            'action' => $affirmed ? 'granted' : 'declined',
            'granted_by' => $grantedBy,
            'guardian_name' => $validated['guardian_name'] ?? null,
            'guardian_relationship' => $validated['guardian_relationship'] ?? null,
            'occurred_at' => Date::now(),
            'ip_address' => $request->ip(),
            'user_agent' => substr((string) $request->userAgent(), 0, 255),
        ]);

        $this->applyDecisionToPatient($patient, $type, $affirmed);

        $this->audit->record(
            $affirmed ? 'consent.granted' : 'consent.declined',
            subjectType: 'ConsentRecord',
            subjectId: $record->id,
            metadata: [
                'patient_id' => $patient->id,
                'consent_type' => $type,
                'policy_version' => self::POLICY_VERSION,
                'granted_by' => $grantedBy,
                'patient_status' => $patient->status->value,
            ],
        );

        return (new ConsentRecordResource($record))->response()->setStatusCode(201);
    }

    /**
     * Withdraw a consent previously granted.
     *
     * A NEW record. The grant it revokes is left exactly as written -- a
     * consent history that can be edited proves nothing at all.
     */
    public function withdraw(WithdrawConsentRequest $request, Patient $patient): JsonResponse
    {
        $this->authorize('update', $patient);

        /** @var array{consent_type: string} $validated */
        $validated = $request->validated();
        $type = $validated['consent_type'];

        $grant = $this->latestDecision($patient, $type);

        if ($grant === null || $grant->action !== 'granted') {
            throw new IllegalTransition(
                'There is no active consent of that kind to withdraw.'
            );
        }

        $record = ConsentRecord::create([
            'patient_id' => $patient->id,
            'consent_type' => $type,
            // The version and hash of the GRANT being revoked, not today's.
            // What the patient is walking back is the text they agreed to.
            'policy_version' => $grant->getAttribute('policy_version'),
            'policy_text_hash' => $grant->getAttribute('policy_text_hash'),
            'action' => 'withdrawn',
            'granted_by' => $grant->getAttribute('granted_by'),
            'occurred_at' => Date::now(),
            'ip_address' => $request->ip(),
            'user_agent' => substr((string) $request->userAgent(), 0, 255),
        ]);

        // Withdrawing the processing consent halts NEW processing. It does not
        // erase the medical record: the clinic is the controller and its
        // retention obligation is its own to discharge.
        if ($type === 'data_processing' && $patient->status === PatientStatus::Active) {
            $patient->status->assertCanTransitionTo(PatientStatus::Withdrawn);
            $patient->status = PatientStatus::Withdrawn;
            $patient->save();
        }

        $this->audit->record(
            'consent.withdrawn',
            subjectType: 'ConsentRecord',
            subjectId: $record->id,
            metadata: [
                'patient_id' => $patient->id,
                'consent_type' => $type,
                'withdraws_record_id' => $grant->id,
                'patient_status' => $patient->status->value,
            ],
        );

        return (new ConsentRecordResource($record))->response()->setStatusCode(201);
    }

    /**
     * The rules that make a decision recordable at all.
     *
     * @throws IllegalTransition|ValidationException
     */
    protected function assertDecisionIsPossible(
        Patient $patient,
        string $type,
        bool $affirmed,
        string $grantedBy,
    ): void {
        if ($patient->status === PatientStatus::Discarded) {
            throw new IllegalTransition(
                'This registration ended when consent was declined. Register again to start over.'
            );
        }

        // A minor consents through a guardian, for every consent type. Recording
        // a minor's own tick as the lawful basis would be recording something
        // that is not one.
        $dateOfBirth = $patient->date_of_birth;

        if ($dateOfBirth !== null && $dateOfBirth->diffInYears(Date::now()) < 18 && $grantedBy !== 'guardian') {
            throw ValidationException::withMessages([
                'granted_by' => 'A patient under 18 consents through a guardian.',
            ]);
        }

        // Asked at registration, this would be pre-emptive consent to a
        // disclosure that may never happen -- which is not specific consent.
        if ($type === 'delivery_disclosure' && $patient->status === PatientStatus::PendingConsent) {
            throw new IllegalTransition(
                'Delivery disclosure is agreed when the patient chooses delivery, not at registration.'
            );
        }

        // Without consent to process at all, nothing else proceeds.
        if ($affirmed && $type !== 'data_processing' && ! $this->hasGranted($patient, 'data_processing')) {
            throw new IllegalTransition(
                'Consent to process data comes first. Without it, nothing else can be agreed.'
            );
        }
    }

    /**
     * Move the patient's own state on the back of the decision.
     */
    protected function applyDecisionToPatient(Patient $patient, string $type, bool $affirmed): void
    {
        if ($type !== 'data_processing') {
            return;
        }

        if (! $affirmed) {
            $this->discard($patient);

            return;
        }

        if ($patient->status->canTransitionTo(PatientStatus::Active)) {
            $patient->status->assertCanTransitionTo(PatientStatus::Active);
            $patient->status = PatientStatus::Active;
            $patient->save();
        }
    }

    /**
     * Declining ends registration and leaves no footprint worth the name.
     *
     * Only the minimal contact detail needed to explain why service cannot
     * proceed survives, and it is purged on schedule. Everything else collected
     * during the abandoned registration goes now: a person who said no should
     * not be left with a profile here.
     */
    protected function discard(Patient $patient): void
    {
        $patient->status->assertCanTransitionTo(PatientStatus::Discarded);

        $patient->forceFill([
            'status' => PatientStatus::Discarded,
            'email' => null,
            'date_of_birth' => null,
            'sex' => null,
            'national_id_number' => null,
            'address' => null,
            'district' => null,
        ])->save();
    }

    protected function hasGranted(Patient $patient, string $type): bool
    {
        return $this->latestDecision($patient, $type)?->action === 'granted';
    }

    /**
     * The most recent decision of one type, whatever it was.
     */
    protected function latestDecision(Patient $patient, string $type): ?ConsentRecord
    {
        return ConsentRecord::query()
            ->where('patient_id', $patient->id)
            ->where('consent_type', $type)
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * The policy with the clinic's name filled in, per language.
     *
     * @return array<string, string>
     */
    protected function renderedPolicy(?Tenant $tenant): array
    {
        $clinic = 'this clinic';

        if ($tenant !== null) {
            $trading = $tenant->getAttribute('trading_name');
            $clinic = is_string($trading) && $trading !== '' ? $trading : $tenant->legal_name;
        }

        return array_map(
            static fn (string $text): string => str_replace('{clinic}', $clinic, $text),
            self::POLICY_TEXT,
        );
    }

    /**
     * A hash of the exact text shown, version included.
     *
     * Over the WHOLE document, both languages, because both appear on the same
     * screen. Changing either one changes the hash, which is what catches a
     * wording edit that nobody remembered to version.
     *
     * @param  array<string, string>  $text
     */
    protected function policyTextHash(array $text): string
    {
        ksort($text);

        return hash('sha256', self::POLICY_VERSION."\n".implode("\n", $text));
    }

    protected function tenantOf(Request $request): ?Tenant
    {
        $tenant = $request->attributes->get('tenant');

        return $tenant instanceof Tenant ? $tenant : null;
    }
}
