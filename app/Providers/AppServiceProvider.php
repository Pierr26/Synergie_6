<?php

namespace App\Providers;

use Anthropic\Client;
use App\Services\Agent\ClaudeAssessmentModel;
use App\Services\Agent\Contracts\AssessmentModel;
use App\Services\Agent\CrewContext;
use App\Services\Agent\KnowledgeSearch;
use App\Services\Agent\UnconfiguredAssessmentModel;
use App\Services\Reports\GroundReportReceiver;
use App\Services\Rules\SleepRule;
use Dedoc\Scramble\Scramble;
use Dedoc\Scramble\Support\Generator\OpenApi;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Support\Generator\Parameter;
use Dedoc\Scramble\Support\Generator\SecurityRequirement;
use Dedoc\Scramble\Support\Generator\SecurityScheme;
use Dedoc\Scramble\Support\RouteInfo;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(GroundReportReceiver::class, fn (): GroundReportReceiver => new GroundReportReceiver(
            config('hexta.receiver_name'),
        ));

        $this->app->singleton(SleepRule::class, fn (): SleepRule => SleepRule::fromConfig());

        $this->app->bind(AssessmentModel::class, function ($app): AssessmentModel {
            $apiKey = config('services.anthropic.key');

            if (blank($apiKey)) {
                return new UnconfiguredAssessmentModel;
            }

            return new ClaudeAssessmentModel(
                client: new Client(apiKey: $apiKey, requestOptions: [
                    'timeout' => (float) config('hexta.agent.timeout_seconds'),
                    'maxRetries' => 2,
                ]),
                knowledge: $app->make(KnowledgeSearch::class),
                crewContext: $app->make(CrewContext::class),
                model: config('hexta.agent.model'),
                effort: config('hexta.agent.effort'),
                maxTokens: config('hexta.agent.max_tokens'),
                maxToolRounds: config('hexta.agent.max_tool_rounds'),
            );
        });
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        RateLimiter::for('agent', fn (Request $request): Limit => Limit::perMinute(10)->by($request->ip()));

        $this->configureApiDocumentation();
    }

    /**
     * Make the OpenAPI docs usable outside local: open access behind a flag, the
     * X-Hexta-Actor header as a security scheme and the two workspaces as an enum.
     */
    private function configureApiDocumentation(): void
    {
        Gate::define('viewApiDocs', fn (mixed $user = null): bool => (bool) config('hexta.api_docs.public'));

        $actorScheme = 'HextaActor';

        Scramble::configure()
            ->withDocumentTransformers(function (OpenApi $openApi) use ($actorScheme): void {
                $openApi->components->addSecurityScheme(
                    $actorScheme,
                    SecurityScheme::apiKey('header', config('hexta.identity.header'))
                        ->setDescription('crewId of the acting crew member or CMO (e.g. CMO-01, CDR-01). Required only when HEXTA_REQUIRE_ACTOR=true.'),
                );
            })
            ->withOperationTransformers(function (Operation $operation, RouteInfo $routeInfo) use ($actorScheme): void {
                if (! in_array('hexta.actor', $routeInfo->route->gatherMiddleware(), true)) {
                    return;
                }

                $operation->security = [new SecurityRequirement([]), new SecurityRequirement([$actorScheme => []])];

                foreach ($operation->parameters as $parameter) {
                    if ($parameter instanceof Parameter && $parameter->in === 'path' && $parameter->name === 'workspace' && $parameter->schema !== null) {
                        $parameter->schema->type->enum(config('hexta.workspaces'));
                        $parameter->example = 'demo';
                    }
                }
            });
    }
}
