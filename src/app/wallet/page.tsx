'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Wallet,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  CreditCard,
  RefreshCw,
  Grid3X3,
  ChevronLeft,
  Building2,
  TrendingUp,
  ArrowRight,
} from 'lucide-react'

interface Transaction {
  id: string
  amount: number
  type: 'CREDIT' | 'DEBIT'
  description: string
  status: 'PENDING' | 'COMPLETED' | 'FAILED'
  createdAt: string
}

interface WalletData {
  balance: number
  transactions: Transaction[]
  pagination: {
    total: number
    page: number
    limit: number
    totalPages: number
  }
}

export default function WalletPage() {
  const { data: session } = useSession()
  const router = useRouter()

  const [walletData, setWalletData] = useState<WalletData>({
    balance: 0,
    transactions: [],
    pagination: { total: 0, page: 1, limit: 10, totalPages: 0 }
  })
  const [loading, setLoading] = useState(true)
  const [rechargeAmount, setRechargeAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [showWithdrawForm, setShowWithdrawForm] = useState(false)
  const [bankDetails, setBankDetails] = useState({
    accountNumber: '',
    ifscCode: '',
    accountHolderName: ''
  })

  useEffect(() => {
    if (!session?.user?.id) {
      router.push('/auth/signin')
      return
    }
    fetchWalletData()
  }, [session, router])

  const fetchWalletData = async () => {
    try {
      setLoading(true)
      const [balanceRes, transactionsRes] = await Promise.all([
        fetch('/api/wallet'),
        fetch('/api/transactions')
      ])

      const balanceData = await balanceRes.json()
      const transactionsData = await transactionsRes.json()

      setWalletData({
        balance: balanceData.balance || 0,
        transactions: transactionsData.transactions || [],
        pagination: transactionsData.pagination || { total: 0, page: 1, limit: 10, totalPages: 0 }
      })
    } catch (error) {
      console.error('Error fetching wallet data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleRecharge = async () => {
    const amount = parseFloat(rechargeAmount)
    if (!amount || amount < 1) {
      alert('Please enter a valid amount')
      return
    }

    setIsProcessing(true)
    try {
      const response = await fetch('/api/payments/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount })
      })

      const orderData = await response.json()
      if (!response.ok) throw new Error(orderData.error || 'Failed to create order')

      // Simulate payment success
      const verifyResponse = await fetch('/api/payments/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: orderData.orderId,
          paymentId: `pay_${Date.now()}`,
          signature: 'mock_signature',
          transactionId: orderData.transactionId
        })
      })

      if (verifyResponse.ok) {
        const verifyData = await verifyResponse.json()
        setWalletData(prev => ({ ...prev, balance: verifyData.balance }))
        setRechargeAmount('')
        fetchWalletData()
        alert(`Successfully added ₹${amount} to your wallet!`)
      }
    } catch (error) {
      console.error('Payment error:', error)
      alert('Payment failed. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount)

    if (!amount || amount < 100) {
      alert('Minimum withdrawal amount is ₹100')
      return
    }

    if (amount > walletData.balance) {
      alert('Insufficient balance')
      return
    }

    if (!bankDetails.accountNumber || !bankDetails.ifscCode || !bankDetails.accountHolderName) {
      alert('Please provide complete bank details')
      return
    }

    setIsProcessing(true)
    try {
      const response = await fetch('/api/wallet/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, bankDetails })
      })

      if (response.ok) {
        alert('Withdrawal request submitted successfully!')
        setWithdrawAmount('')
        setBankDetails({ accountNumber: '', ifscCode: '', accountHolderName: '' })
        setShowWithdrawForm(false)
        fetchWalletData()
      } else {
        const data = await response.json()
        alert(data.error || 'Withdrawal failed')
      }
    } catch (error) {
      console.error('Withdrawal error:', error)
      alert('Withdrawal failed. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  if (!session?.user?.id) return null

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-2 border-muted border-t-primary animate-spin mx-auto" />
          <p className="text-muted-foreground">Loading wallet...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Navigation */}
      <header className="nav-header">
        <div className="container-default">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/dashboard">
                <Button variant="ghost" size="icon-sm">
                  <ChevronLeft className="w-5 h-5" />
                </Button>
              </Link>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary text-primary-foreground">
                  <Wallet className="w-5 h-5" />
                </div>
                <span className="text-lg font-semibold">Wallet</span>
              </div>
            </div>

            <Button variant="ghost" size="sm" onClick={fetchWalletData}>
              <RefreshCw className="w-4 h-4" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="container-default py-8 space-y-8">
        {/* Balance Card */}
        <Card variant="highlight" className="animate-fade-in-up">
          <CardContent className="p-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Available Balance</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold">₹{walletData.balance.toFixed(2)}</span>
                </div>
              </div>
              <div className="flex gap-3">
                <Button onClick={() => document.getElementById('add-money')?.scrollIntoView({ behavior: 'smooth' })}>
                  <Plus className="w-4 h-4" />
                  Add Money
                </Button>
                <Button variant="outline" onClick={() => setShowWithdrawForm(!showWithdrawForm)}>
                  <ArrowUpRight className="w-4 h-4" />
                  Withdraw
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - Actions */}
          <div className="space-y-6">
            {/* Add Money */}
            <Card id="add-money" className="animate-fade-in-up stagger-1">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="w-5 h-5 text-primary" />
                  Add Money
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  type="number"
                  placeholder="Enter amount"
                  value={rechargeAmount}
                  onChange={(e) => setRechargeAmount(e.target.value)}
                  min="1"
                  max="10000"
                />

                <div className="grid grid-cols-3 gap-2">
                  {[100, 500, 1000].map((amount) => (
                    <Button
                      key={amount}
                      variant="outline"
                      size="sm"
                      onClick={() => setRechargeAmount(amount.toString())}
                    >
                      ₹{amount}
                    </Button>
                  ))}
                </div>

                <Button
                  onClick={handleRecharge}
                  disabled={isProcessing || !rechargeAmount}
                  loading={isProcessing}
                  className="w-full"
                >
                  <CreditCard className="w-4 h-4" />
                  Add Money
                </Button>
              </CardContent>
            </Card>

            {/* Withdraw */}
            {showWithdrawForm && (
              <Card className="animate-fade-in-up">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ArrowUpRight className="w-5 h-5 text-destructive" />
                    Withdraw Funds
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Input
                    type="number"
                    placeholder="Amount (min ₹100)"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    min="100"
                    max={walletData.balance}
                  />

                  <div className="space-y-3">
                    <Input
                      placeholder="Account Number"
                      value={bankDetails.accountNumber}
                      onChange={(e) => setBankDetails(prev => ({ ...prev, accountNumber: e.target.value }))}
                      icon={<Building2 className="w-4 h-4" />}
                    />
                    <Input
                      placeholder="IFSC Code"
                      value={bankDetails.ifscCode}
                      onChange={(e) => setBankDetails(prev => ({ ...prev, ifscCode: e.target.value }))}
                    />
                    <Input
                      placeholder="Account Holder Name"
                      value={bankDetails.accountHolderName}
                      onChange={(e) => setBankDetails(prev => ({ ...prev, accountHolderName: e.target.value }))}
                    />
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setShowWithdrawForm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      onClick={handleWithdraw}
                      disabled={isProcessing || !withdrawAmount}
                      loading={isProcessing}
                    >
                      Withdraw
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Quick Stats */}
            <Card className="animate-fade-in-up stagger-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-muted-foreground" />
                  Statistics
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Total Transactions</span>
                  <span className="font-semibold">{walletData.pagination.total}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">This Month</span>
                  <span className="font-semibold">
                    {walletData.transactions.filter(t =>
                      new Date(t.createdAt).getMonth() === new Date().getMonth()
                    ).length}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Transactions */}
          <div className="lg:col-span-2">
            <Card className="animate-fade-in-up stagger-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-muted-foreground" />
                  Transaction History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {walletData.transactions.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                      <Clock className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="font-semibold mb-2">No transactions yet</h3>
                    <p className="text-sm text-muted-foreground">
                      Your transaction history will appear here
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {walletData.transactions.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="flex items-center justify-between p-4 rounded-xl border border-border hover:bg-muted/30 transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                            transaction.type === 'CREDIT'
                              ? 'bg-success/10 text-success'
                              : 'bg-destructive/10 text-destructive'
                          }`}>
                            {transaction.type === 'CREDIT' ? (
                              <ArrowDownLeft className="w-5 h-5" />
                            ) : (
                              <ArrowUpRight className="w-5 h-5" />
                            )}
                          </div>
                          <div>
                            <p className="font-medium">{transaction.description}</p>
                            <p className="text-sm text-muted-foreground">{formatDate(transaction.createdAt)}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${
                            transaction.type === 'CREDIT' ? 'text-success' : 'text-destructive'
                          }`}>
                            {transaction.type === 'CREDIT' ? '+' : '-'}₹{transaction.amount.toFixed(2)}
                          </p>
                          <Badge
                            variant={
                              transaction.status === 'COMPLETED' ? 'success' :
                              transaction.status === 'PENDING' ? 'warning' : 'destructive'
                            }
                            size="sm"
                          >
                            {transaction.status}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
