import { Module } from '@nestjs/common';
import { CashBookController } from './cash-book.controller.js';
import { CashBookService } from './cash-book.service.js';

@Module({ controllers: [CashBookController], providers: [CashBookService], exports: [CashBookService] })
export class CashBookModule {}
