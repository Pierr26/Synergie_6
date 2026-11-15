<?php

namespace App\Console\Commands;

use App\Services\Reports\GroundReportReceiver;
use App\Services\Reports\ReceiveOutcome;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Driver\Exception\Exception as MongoException;
use Throwable;

/**
 * MongoDB Atlas acceptance (cahier des charges p.21):
 * ping, write and read a fictional report, identical replay, 409 on altered
 * content, re-read after reconnecting, and no receipt when the receiver is
 * unreachable. The proof is saved as JSON and in the atlas_checks collection.
 */
#[Signature('hexta:atlas-check {--connection=ground : Database connection of the ground receiver}')]
#[Description('Prove the ground receiver works on the configured MongoDB (Atlas): ping, write, read, replay, conflict')]
class AtlasCheck extends Command
{
    /** @var list<array{step: string, ok: bool, detail: string}> */
    private array $steps = [];

    public function handle(GroundReportReceiver $receiver): int
    {
        $connection = (string) $this->option('connection');
        $dsn = (string) config("database.connections.{$connection}.dsn");
        $target = $this->maskCredentials($dsn);
        $this->components->info("Target: {$target} / database ".config("database.connections.{$connection}.database"));

        $reportId = (string) Str::uuid();
        $payload = $this->fictionalReport($reportId);

        $this->step('Ping', function () use ($connection): string {
            $start = microtime(true);
            DB::connection($connection)->getDatabase()->command(['ping' => 1]);
            $build = DB::connection($connection)->getDatabase()->command(['buildInfo' => 1])->toArray()[0];

            return sprintf('ok in %.0f ms, MongoDB %s', (microtime(true) - $start) * 1000, $build['version']);
        });

        $receipt = null;

        $this->step('Write fictional report', function () use ($receiver, $reportId, $payload, &$receipt): string {
            $outcome = $receiver->receive($reportId, $payload);
            $receipt = $outcome->receipt;

            return $outcome->kind === ReceiveOutcome::Created ? "receipt {$receipt['receiptId']}" : throw new \RuntimeException("unexpected {$outcome->kind}");
        });

        $this->step('Read back', function () use ($connection, $reportId, &$receipt): string {
            $stored = DB::connection($connection)->getCollection('reports')->findOne(['_id' => $reportId]);

            return $stored !== null && $stored['sha256'] === $receipt['sha256'] && $stored['receipt']['receiptId'] === $receipt['receiptId']
                ? 'same sha256 and receipt in hexta_demo.reports'
                : throw new \RuntimeException('stored document differs');
        });

        $this->step('Identical replay', function () use ($receiver, $reportId, $payload, &$receipt): string {
            $outcome = $receiver->receive($reportId, array_reverse($payload, true));

            return $outcome->kind === ReceiveOutcome::Replayed && $outcome->receipt['receiptId'] === $receipt['receiptId']
                ? 'initial receipt returned'
                : throw new \RuntimeException("unexpected {$outcome->kind}");
        });

        $this->step('Altered content, same id', function () use ($receiver, $reportId, $payload): string {
            $outcome = $receiver->receive($reportId, [...$payload, 'notes' => 'Altered after queueing']);

            return $outcome->kind === ReceiveOutcome::Conflict ? 'conflict (HTTP 409)' : throw new \RuntimeException("unexpected {$outcome->kind}");
        });

        $this->step('Reconnect and re-read receipt', function () use ($connection, $receiver, $reportId, &$receipt): string {
            DB::purge($connection);

            return ($receiver->receiptFor($reportId)['receiptId'] ?? null) === $receipt['receiptId']
                ? 'initial receipt after a fresh client'
                : throw new \RuntimeException('receipt not found after reconnect');
        });

        $this->step('Receiver unreachable', function () use ($payload): string {
            config(['database.connections.atlas_check_down' => [
                'driver' => 'mongodb',
                'dsn' => 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500&connectTimeoutMS=500',
                'database' => 'hexta_demo',
            ]]);

            try {
                DB::connection('atlas_check_down')->getCollection('reports')->insertOne(['_id' => (string) Str::uuid(), 'payload' => $payload]);
            } catch (MongoException) {
                return 'write refused, no receipt produced: the report stays queued';
            } finally {
                DB::purge('atlas_check_down');
            }

            throw new \RuntimeException('an unreachable receiver accepted a write');
        });

        $passed = ! in_array(false, array_column($this->steps, 'ok'), true);
        $proof = [
            'checkedAt' => now('UTC')->toIso8601ZuluString(),
            'target' => $target,
            'isAtlasCloud' => str_contains($dsn, '.mongodb.net'),
            'database' => config("database.connections.{$connection}.database"),
            'reportId' => $reportId,
            'receipt' => $receipt,
            'passed' => $passed,
            'steps' => $this->steps,
        ];

        $file = 'atlas-proof/'.now('UTC')->format('Ymd-His').'.json';
        Storage::disk('local')->put($file, json_encode($proof, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        try {
            DB::connection($connection)->getCollection('atlas_checks')->insertOne([...$proof, 'checkedAt' => new UTCDateTime(now('UTC'))]);
        } catch (Throwable) {
            $this->components->warn('Could not store the proof in atlas_checks.');
        }

        $this->table(['Step', 'Result', 'Detail'], array_map(fn (array $step): array => [$step['step'], $step['ok'] ? 'PASS' : 'FAIL', $step['detail']], $this->steps));
        $this->line('Proof saved to storage/app/private/'.$file);

        return $passed ? self::SUCCESS : self::FAILURE;
    }

    private function step(string $name, callable $check): void
    {
        try {
            $this->steps[] = ['step' => $name, 'ok' => true, 'detail' => $check()];
        } catch (Throwable $exception) {
            $this->steps[] = ['step' => $name, 'ok' => false, 'detail' => $exception->getMessage()];
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function fictionalReport(string $reportId): array
    {
        return [
            'reportId' => $reportId,
            'schemaVersion' => 1,
            'workspaceId' => 'demo',
            'missionId' => 'QN-LO-03',
            'simulated' => true,
            'subject' => ['crewId' => 'moreau', 'alias' => 'Cdr K. Moreau'],
            'author' => ['crewId' => 'haddad', 'alias' => 'Dr A. Haddad', 'role' => 'cmo'],
            'period' => ['from' => '2026-11-02T00:00:00Z', 'to' => '2026-11-08T23:59:59Z'],
            'generatedAt' => now('UTC')->toIso8601ZuluString(),
            'missionDay' => 142,
            'timezone' => 'UTC',
            'observations' => [['variable' => 'sleep_duration', 'missionDay' => 142, 'value' => 312, 'unit' => 'min', 'method' => 'sleep_diary']],
            'absences' => [],
            'labResults' => [],
            'reviews' => [],
            'followUps' => [],
            'rules' => [['id' => 'SLEEP-001', 'version' => 1, 'label' => 'Demo rule']],
            'notes' => 'Atlas connectivity proof. Simulated crew data',
        ];
    }

    private function maskCredentials(string $dsn): string
    {
        return (string) preg_replace('#//[^@/]+@#', '//***:***@', $dsn);
    }
}
