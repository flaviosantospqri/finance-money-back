import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { FinancialForecastsService } from './financial-forecasts.service.js';
import {
  CloseForecastDto,
  CopyForecastsMonthDto,
  CreateDestinationDto,
  CreateForecastDto,
  CreateForecastGroupDto,
  DistributionDto,
  ReconcileForecastDto,
  UpdateForecastGroupDto,
  UpdateForecastDto,
} from './dto/forecast.dto.js';

@Controller('financial-forecasts')
export class FinancialForecastsController {
  constructor(private readonly forecasts: FinancialForecastsService) {}

  @Get('summary') summary(@Query('period') period: string) {
    return this.forecasts.summary(period);
  }
  @Get('destinations') destinations() {
    return this.forecasts.getDestinations();
  }
  @Post('destinations') createDestination(@Body() body: CreateDestinationDto) {
    return this.forecasts.createDestination(body.name);
  }
  @Get('groups') groups() {
    return this.forecasts.getGroups();
  }
  @Post('groups') createGroup(@Body() body: CreateForecastGroupDto) {
    return this.forecasts.createGroup(body.name);
  }
  @Patch('groups/:id') updateGroup(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateForecastGroupDto,
  ) {
    return this.forecasts.updateGroup(id, body.name);
  }
  @Delete('groups/:id') deleteGroup(@Param('id', ParseUUIDPipe) id: string) {
    return this.forecasts.deleteGroup(id);
  }
  @Get('distributions') distributions(@Query('period') period: string) {
    return this.forecasts.getDistributions(period);
  }
  @Post('copy-month') copyMonth(@Body() body: CopyForecastsMonthDto) {
    return this.forecasts.copyMonth(body.period, body.targetPeriod);
  }
  @Put('distributions/:period') saveDistributions(
    @Param('period') period: string,
    @Body() body: { entries: { destinationId: string; percentage?: string; valueType?: 'percentage' | 'fixed'; value?: string }[] },
  ) {
    return this.forecasts.saveDistributions(period, body.entries);
  }
  @Post('distributions/copy') copyDistributions(@Body() body: DistributionDto) {
    return this.forecasts.copyDistributions(body.period, body.targetPeriod);
  }
  @Get() findAll(
    @Query()
    filters: {
      period?: string;
      kind?: string;
      categoryId?: string;
      status?: string;
      search?: string;
      fromDate?: string;
      toDate?: string;
    },
  ) {
    return this.forecasts.findAll(filters);
  }
  @Post() create(@Body() body: CreateForecastDto) {
    return this.forecasts.create(body);
  }
  @Get(':id/matches') matches(@Param('id', ParseUUIDPipe) id: string) {
    return this.forecasts.matches(id);
  }
  @Get(':id') findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.forecasts.findOne(id);
  }
  @Post(':id/duplicate') duplicate(@Param('id', ParseUUIDPipe) id: string) {
    return this.forecasts.duplicate(id);
  }
  @Post(':id/reconcile') reconcile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReconcileForecastDto,
  ) {
    if (body.entryIds?.length)
      return this.forecasts.reconcileMany(id, body.entryIds);
    if (!body.entryId)
      throw new BadRequestException('Selecione ao menos uma movimentação.');
    return this.forecasts.reconcile(id, body.entryId, body.amount);
  }
  @Delete(':id/reconciliations/:reconciliationId') unlink(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('reconciliationId', ParseUUIDPipe) reconciliationId: string,
  ) {
    return this.forecasts.unlink(id, reconciliationId);
  }
  @Post(':id/close') close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CloseForecastDto,
  ) {
    return this.forecasts.close(id, body.reason);
  }
  @Patch(':id') update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateForecastDto,
    @Query('scope') scope: 'occurrence' | 'future' = 'occurrence',
  ) {
    return this.forecasts.update(id, body, scope);
  }
  @Delete(':id') remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('scope') scope: 'occurrence' | 'future' = 'occurrence',
  ) {
    return this.forecasts.remove(id, scope);
  }
}
